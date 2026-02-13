import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read .env from project root
const envPath = resolve(import.meta.dirname, '..', '.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf-8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=').map((s) => s.trim())),
);

const id = env.EC2_INSTANCE_ID;
const region = env.EC2_REGION || 'eu-west-2';

if (!id) {
  console.error('EC2_INSTANCE_ID not set in .env');
  process.exit(1);
}

const cmd = process.argv[2];
const commands = {
  start: `aws ec2 start-instances --instance-ids ${id} --region ${region}`,
  stop: `aws ec2 stop-instances --instance-ids ${id} --region ${region}`,
  status: `aws ec2 describe-instance-status --instance-ids ${id} --region ${region} --include-all-instances`,
};

if (!commands[cmd]) {
  console.error(`Usage: node scripts/aws.mjs [start|stop|status]`);
  process.exit(1);
}

execSync(commands[cmd], { stdio: 'inherit' });
