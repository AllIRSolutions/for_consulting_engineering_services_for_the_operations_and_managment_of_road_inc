/**
 * AI Chatbot Module
 * Provides intelligent assistance using Claude API
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function chat(message, context = {}) {
  if (!ANTHROPIC_API_KEY) {
    return { reply: 'AI assistant is not configured. Please set ANTHROPIC_API_KEY.' };
  }

  const systemPrompt = `You are an AI assistant for road-incident-management-system, built by AllIR Solutions.
Comprehensive road incident management system for monitoring, detecting, and responding to traffic incidents on Mpumalanga Province roads with integrated safety audit capabilities
Help users understand and use this system effectively.
- Analyze incident patterns and suggest preventive measures\n- Provide real-time safety audit guidance and checklists\n- Recommend optimal emergency response strategies\n- Generate incident severity assessments\n- Offer road safety improvement suggestions\n- Assist with compliance requirement interpretation\n- Provide historical data insights and trend analysis\n- Support decision-making with data-driven recommendations\n- Help with resource allocation optimization\n- Offer training guidance for response procedures`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      }),
    });

    const data = await res.json();
    return { reply: data.content?.[0]?.text || 'Sorry, I could not process that.' };
  } catch (e) {
    return { reply: `AI error: ${e.message}` };
  }
}
