import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import Anthropic from '@anthropic-ai/sdk';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP'
});
app.use(limiter);

let db;

const initDatabase = async () => {
  db = await open({
    filename: join(__dirname, 'road_incident_management.db'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      location TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      severity TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'reported',
      description TEXT,
      reported_by TEXT,
      response_team TEXT,
      response_time INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS road_network (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      road_name TEXT NOT NULL,
      road_type TEXT NOT NULL,
      start_point TEXT,
      end_point TEXT,
      total_length REAL,
      surface_condition TEXT DEFAULT 'good',
      speed_limit INTEGER,
      current_conditions TEXT,
      last_inspected DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS safety_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      road_section TEXT NOT NULL,
      audit_type TEXT NOT NULL,
      scheduled_date DATETIME,
      auditor_assigned TEXT,
      status TEXT DEFAULT 'scheduled',
      priority TEXT DEFAULT 'medium',
      checklist_items TEXT,
      findings TEXT,
      recommendations TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS emergency_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER,
      team_id TEXT,
      response_type TEXT,
      dispatch_time DATETIME,
      arrival_time DATETIME,
      completion_time DATETIME,
      resources_deployed TEXT,
      notes TEXT,
      FOREIGN KEY (incident_id) REFERENCES incidents (id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipients TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS compliance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requirement_type TEXT NOT NULL,
      compliance_status TEXT DEFAULT 'pending',
      audit_date DATETIME,
      findings TEXT,
      corrective_actions TEXT,
      deadline DATETIME,
      responsible_party TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mobile_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      sync_timestamp DATETIME,
      data_payload TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS external_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_name TEXT NOT NULL,
      endpoint_url TEXT,
      last_sync DATETIME,
      sync_status TEXT DEFAULT 'active',
      data_cache TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.run(`
    INSERT OR IGNORE INTO road_network (road_name, road_type, start_point, end_point, total_length, speed_limit, current_conditions)
    VALUES 
    ('N4 Highway', 'National', 'Pretoria', 'Maputo Border', 570.5, 120, 'Good visibility, light traffic'),
    ('R40 Route', 'Regional', 'Barberton', 'Hazyview', 120.3, 100, 'Moderate traffic, construction zone km 45-50'),
    ('N17 Highway', 'National', 'Springs', 'Ermelo', 180.7, 120, 'Heavy traffic, weather advisory - fog'),
    ('R36 Route', 'Regional', 'Lydenburg', 'Ohrigstad', 95.2, 80, 'Clear conditions, normal traffic flow');
  `);

  console.log('Database initialized successfully');
};

const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
};

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.post('/api/incidents', async (req, res) => {
  try {
    const {
      type,
      location,
      latitude,
      longitude,
      severity,
      description,
      reported_by
    } = req.body;

    const result = await db.run(`
      INSERT INTO incidents (type, location, latitude, longitude, severity, description, reported_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [type, location, latitude, longitude, severity || 'medium', description, reported_by]);

    const incident = await db.get('SELECT * FROM incidents WHERE id = ?', [result.lastID]);
    
    res.status(201).json({
      success: true,
      incident,
      message: 'Incident reported successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create incident', details: error.message });
  }
});

app.get('/api/incidents', async (req, res) => {
  try {
    const { 
      status, 
      severity, 
      location, 
      page = 1, 
      limit = 20, 
      sort = 'created_at', 
      order = 'DESC' 
    } = req.query;

    let query = 'SELECT * FROM incidents WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (severity) {
      query += ' AND severity = ?';
      params.push(severity);
    }
    if (location) {
      query += ' AND location LIKE ?';
      params.push(`%${location}%`);
    }

    query += ` ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const incidents = await db.all(query, params);
    const totalCount = await db.get('SELECT COUNT(*) as count FROM incidents');

    res.json({
      success: true,
      incidents,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount.count,
        totalPages: Math.ceil(totalCount.count / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch incidents', details: error.message });
  }
});

app.put('/api/incidents/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, response_actions } = req.body;

    await db.run(`
      UPDATE incidents 
      SET status = ?, updated_at = CURRENT_TIMESTAMP, resolved_at = ?
      WHERE id = ?
    `, [status, status === 'resolved' ? new Date().toISOString() : null, id]);

    const incident = await db.get('SELECT * FROM incidents WHERE id = ?', [id]);
    
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.json({
      success: true,
      incident,
      message: 'Incident status updated successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update incident status', details: error.message });
  }
});

app.post('/api/incidents/:id/response', async (req, res) => {
  try {
    const { id } = req.params;
    const { team_id, response_type, resources_deployed, notes } = req.body;

    await db.run(`
      INSERT INTO emergency_responses (incident_id, team_id, response_type, dispatch_time, resources_deployed, notes)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    `, [id, team_id, response_type, JSON.stringify(resources_deployed), notes]);

    await db.run(`
      UPDATE incidents SET status = 'responding', response_team = ? WHERE id = ?
    `, [team_id, id]);

    res.json({
      success: true,
      message: 'Emergency response team dispatched successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to dispatch response team', details: error.message });
  }
});

app.get('/api/road-network/mpumalanga', async (req, res) => {
  try {
    const roads = await db.all(`
      SELECT 
        r.*,
        COUNT(i.id) as active_incidents
      FROM road_network r
      LEFT JOIN incidents i ON i.location LIKE '%' || r.road_name || '%' AND i.status != 'resolved'
      GROUP BY r.id
      ORDER BY r.road_name
    `);

    res.json({
      success: true,
      roads,
      province: 'Mpumalanga',
      last_updated: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch road network data', details: error.message });
  }
});

app.post('/api/safety-audits', async (req, res) => {
  try {
    const {
      road_section,
      audit_type,
      scheduled_date,
      auditor_assigned,
      priority,
      checklist_items
    } = req.body;

    const result = await db.run(`
      INSERT INTO safety_audits (road_section, audit_type, scheduled_date, auditor_assigned, priority, checklist_items)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [road_section, audit_type, scheduled_date, auditor_assigned, priority || 'medium', JSON.stringify(checklist_items)]);

    const audit = await db.get('SELECT * FROM safety_audits WHERE id = ?', [result.lastID]);

    res.status(201).json({
      success: true,
      audit,
      message: 'Safety audit scheduled successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to schedule safety audit', details: error.message });
  }
});

app.get('/api/safety-audits/:id/checklist', async (req, res) => {
  try {
    const { id } = req.params;
    
    const audit = await db.get('SELECT * FROM safety_audits WHERE id = ?', [id]);
    
    if (!audit) {
      return res.status(404).json({ error: 'Safety audit not found' });
    }

    const standardChecklist = [
      { item: 'Road surface condition assessment', category: 'Infrastructure', mandatory: true },
      { item: 'Traffic sign visibility and compliance', category: 'Signage', mandatory: true },
      { item: 'Road marking quality and visibility', category: 'Markings', mandatory: true },
      { item: 'Guardrail and barrier inspection', category: 'Safety Features', mandatory: true },
      { item: 'Lighting system functionality', category: 'Lighting', mandatory: false },
      { item: 'Drainage system effectiveness', category: 'Drainage', mandatory: true },
      { item: 'Vegetation management compliance', category: 'Maintenance', mandatory: false },
      { item: 'Emergency stopping areas evaluation', category: 'Safety Features', mandatory: true }
    ];

    res.json({
      success: true,
      audit,
      checklist: standardChecklist,
      custom_items: audit.checklist_items ? JSON.parse(audit.checklist_items) : []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit checklist', details: error.message });
  }
});

app.post('/api/safety-audits/:id/findings', async (req, res) => {
  try {
    const { id } = req.params;
    const { findings, recommendations, completion_notes } = req.body;

    await db.run(`
      UPDATE safety_audits 
      SET findings = ?, recommendations = ?, status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [JSON.stringify(findings), JSON.stringify(recommendations), id]);

    const audit = await db.get('SELECT * FROM safety_audits WHERE id = ?', [id]);

    res.json({
      success: true,
      audit,
      message: 'Safety audit findings submitted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit audit findings', details: error.message });
  }
});

app.get('/api/analytics/dashboard', async (req, res) => {
  try {
    const totalIncidents = await db.get('SELECT COUNT(*) as count FROM incidents');
    const activeIncidents = await db.get('SELECT COUNT(*) as count FROM incidents WHERE status != "resolved"');
    const resolvedToday = await db.get(`
      SELECT COUNT(*) as count FROM incidents 
      WHERE status = 'resolved' AND DATE(resolved_at) = DATE('now')
    `);
    const avgResponseTime = await db.get(`
      SELECT AVG(response_time) as avg_time FROM incidents 
      WHERE response_time IS NOT NULL
    `);

    const incidentsByType = await db.all(`
      SELECT type, COUNT(*) as count 
      FROM incidents 
      WHERE DATE(created_at) >= DATE('now', '-30 days')
      GROUP BY type
    `);

    const incidentsBySeverity = await db.all(`
      SELECT severity, COUNT(*) as count 
      FROM incidents 
      WHERE DATE(created_at) >= DATE('now', '-30 days')
      GROUP BY severity
    `);

    res.json({
      success: true,
      dashboard: {
        summary: {
          total_incidents: totalIncidents.count,
          active_incidents: activeIncidents.count,
          resolved_today: resolvedToday.count,
          avg_response_time: avgResponseTime.avg_time || 0
        },