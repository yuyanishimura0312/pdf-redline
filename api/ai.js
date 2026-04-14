// Vercel Serverless Function: AI completion via Claude API
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { instruction, pageImage, pageNumber, totalPages, pdfName, referenceText } = req.body;

    if (!instruction) {
      return res.status(400).json({ error: 'instruction is required' });
    }

    // Build messages with vision
    const content = [];

    // Add page image if available
    if (pageImage) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: pageImage
        }
      });
    }

    // Build instruction text
    let promptText = `あなたはPDFドキュメントの編集アシスタントです。以下の指示に基づいて、このページの修正テキストを生成してください。

ドキュメント: ${pdfName || 'unknown'}
ページ: ${pageNumber || '?'} / ${totalPages || '?'}

【ユーザーの指示】
${instruction}`;

    if (referenceText) {
      promptText += `\n\n【参考情報】\n${referenceText.substring(0, 10000)}`;
    }

    promptText += `\n\n修正後のテキストのみを出力してください。説明や前置きは不要です。`;

    content.push({ type: 'text', text: promptText });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Claude API error:', errBody);
      return res.status(response.status).json({ error: 'Claude API error' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    return res.status(200).json({ text });
  } catch (e) {
    console.error('AI handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}
