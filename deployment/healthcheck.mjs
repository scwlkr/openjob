import { get } from 'node:http';
// Connect internally, but retain the configured public Host validation.
const origin = new URL(process.env.OPENJOB_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5192');
const request = get({ hostname: '127.0.0.1', port: Number(process.argv[2] ?? 5192), path: '/healthz', headers: { host: origin.host }, timeout: 2500 }, response => {
  response.resume(); process.exitCode = response.statusCode === 200 ? 0 : 1;
});
request.on('timeout', () => request.destroy());
request.on('error', () => { process.exitCode = 1; });
