// Simple in-memory rate limiter (per serverless instance)
const rateLimit = {};
const RATE_WINDOW = 60000; // 1 minute
const RATE_MAX = 10; // max requests per window per IP

function checkRateLimit(ip) {
  const now = Date.now();
  if (!rateLimit[ip] || now - rateLimit[ip].start > RATE_WINDOW) {
    rateLimit[ip] = { start: now, count: 1 };
    return true;
  }
  rateLimit[ip].count++;
  return rateLimit[ip].count <= RATE_MAX;
}

// Vercel Serverless Function: AI completion via Claude API
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'リクエストが多すぎます。1分後に再試行してください。' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { instruction, role, pageImage, pageNumber, totalPages, pdfName, referenceText } = req.body;

    if (!instruction && !role) {
      return res.status(400).json({ error: 'instruction or role is required' });
    }

    // Input size limits
    if (instruction && instruction.length > 5000) {
      return res.status(400).json({ error: 'instruction is too long (max 5000 chars)' });
    }
    if (pageImage && pageImage.length > 5000000) {
      return res.status(400).json({ error: 'Page image is too large. Try zooming out.' });
    }

    // Agent system prompts
    const agentPrompts = {
      designer: `あなたはプロフェッショナルなグラフィックデザイナー・アートディレクターです。20年以上の出版・エディトリアルデザインの経験があります。

このPDFページを分析し、以下の観点からプロの指摘と具体的な改善案を日本語で提示してください。

【分析観点】
1. レイアウト・構成: グリッド、余白、要素配置のバランス
2. タイポグラフィ: フォント選択、サイズ、行間、文字間の適切さ
3. 色彩・コントラスト: 配色の調和、視認性、ブランド一貫性
4. 視覚的階層: 情報の優先順位が視覚的に明確か
5. 画像・図版: 画質、サイズ、キャプション、配置
6. 全体的な印象: プロフェッショナルさ、読みやすさ、印象

【出力形式】
各観点について「問題点 → 改善案」の形式で具体的に記述してください。良い点も指摘してください。改善案は実行可能な具体的な指示にしてください（例:「余白を○mm広げる」「見出しのフォントサイズを○ptに」）。`,

      editor: `あなたはプロフェッショナルな編集者・校正者です。出版社で20年以上の経験があり、学術書、ビジネス書、企画書の編集を専門としています。

このPDFページの文章を分析し、以下の観点からプロの指摘と具体的な改善案を日本語で提示してください。

【分析観点】
1. 文章の明確さ: 曖昧な表現、冗長な文、わかりにくい構文
2. 論理構成: 段落間の流れ、論旨の一貫性、根拠の提示
3. 用語・表記: 専門用語の適切さ、表記ゆれ、統一性
4. 読者への配慮: 想定読者にとっての理解しやすさ、前提知識の説明
5. 校正: 誤字脱字、句読点、助詞の使い方
6. 事実確認ポイント: 数値、固有名詞、日付など確認が必要な箇所

【出力形式】
各指摘は「該当箇所の引用 → 問題点 → 修正案」の形式で記述してください。修正案は差し替え可能な具体的なテキストを含めてください。文章全体への総評も最後に付けてください。`
    };

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

    // Build prompt based on role or free-form instruction
    let promptText;
    if (role && agentPrompts[role]) {
      promptText = agentPrompts[role] + `\n\nドキュメント: ${pdfName || 'unknown'}\nページ: ${pageNumber || '?'} / ${totalPages || '?'}`;
      if (instruction) {
        promptText += `\n\n【追加の指示・気になる点】\n${instruction}`;
      }
    } else {
      promptText = `あなたはPDFドキュメントの編集アシスタントです。以下の指示に基づいて、このページの修正テキストを生成してください。

ドキュメント: ${pdfName || 'unknown'}
ページ: ${pageNumber || '?'} / ${totalPages || '?'}

【ユーザーの指示】
${instruction || ''}`;
    }

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Claude API error:', response.status, errBody);
      let errMsg = 'Claude API error';
      try {
        const parsed = JSON.parse(errBody);
        errMsg = parsed.error?.message || errMsg;
      } catch (_) {}
      return res.status(response.status).json({ error: errMsg });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    return res.status(200).json({ text });
  } catch (e) {
    console.error('AI handler error:', e);
    console.error('AI handler error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
