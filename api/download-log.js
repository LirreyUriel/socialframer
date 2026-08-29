export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  const payload = typeof req.body === 'string'
    ? JSON.parse(req.body || '{}')
    : (req.body || {});

  console.log('[download]', {
    at: payload.at,
    platform: payload.platform,
    profileName: payload.profileName,
    uploadedAvatar: payload.uploadedAvatar,
    attachedScreenshot: payload.attachedScreenshot,
    watermark: payload.watermark,
    content: payload.content
  });

  return res.status(204).end();
}
