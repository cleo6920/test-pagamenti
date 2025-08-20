// api/ping.js
module.exports = (req, res) => {
  res.status(200).json({ ok: true, message: "pong", time: Date.now() });
};
