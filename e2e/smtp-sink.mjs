// Local SMTP sink for E2E only: accepts mail on :2525, exposes captured messages on http://localhost:2526/messages
import { SMTPServer } from 'smtp-server';
import http from 'node:http';

const messages = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, session, cb) {
    let raw = '';
    stream.on('data', (c) => (raw += c.toString('utf8')));
    stream.on('end', () => {
      messages.push({ to: session.envelope.rcptTo.map((r) => r.address), raw, at: Date.now() });
      cb();
    });
  },
});
smtp.listen(2525, '127.0.0.1');
http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const to = url.searchParams.get('to');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(to ? messages.filter((m) => m.to.includes(to)) : messages));
  })
  .listen(2526, '127.0.0.1');
console.log('smtp sink ready');
