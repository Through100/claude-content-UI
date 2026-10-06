import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [outputArgument, skillArgument] = process.argv.slice(2);
if (!outputArgument || !skillArgument) {
  throw new Error('Usage: node scripts/prepare-runtime-release.mjs <new-output-directory> <clean-pinned-skill-checkout>');
}
const app = process.cwd();
const output = path.resolve(outputArgument);
const skill = path.resolve(skillArgument);
const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
const versions = JSON.parse(fs.readFileSync(path.join(app, 'deploy/runtime/versions.json'), 'utf8'));
const uiCommit = git(app, 'rev-parse', 'HEAD');
if (git(app, 'status', '--porcelain')) throw new Error('App checkout must be clean before preparing a release.');
if (git(skill, 'status', '--porcelain')) throw new Error('Skill checkout must be clean before preparing a release.');
if (git(skill, 'rev-parse', 'HEAD') !== versions.skill.commit) throw new Error('Skill checkout does not match the pinned release commit.');
if (fs.existsSync(output)) throw new Error('Use a new output directory; existing release contents will not be overlaid.');
fs.mkdirSync(output, { recursive: true });
const skillName = versions.skill.repository.endsWith('/claude-seo') ? 'claude-seo' : 'claude-blog';
const appHome = skillName === 'claude-seo' ? '/opt/claude-seo-UI' : '/opt/claude-content-UI';
for (const [directory, prefix, name, commit] of [
  [app, 'app/', 'app.tar', uiCommit],
  [skill, `app/${skillName}/`, 'skill.tar', versions.skill.commit],
]) {
  const archive = path.join(output, name);
  // Git archive applies checkout conversion. Override Windows defaults for
  // both source repositories so upstream shebangs remain executable on Linux.
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-C', directory, 'archive', '--format=tar', `--prefix=${prefix}`, `--output=${archive}`, commit]);
  execFileSync('tar', ['-xf', archive, '-C', output]);
  fs.unlinkSync(archive);
}
function verifyLinuxLaunchers(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) verifyLinuxLaunchers(file);
    else if (entry.isFile() && !entry.name.endsWith('.ps1')) {
      const contents = fs.readFileSync(file);
      if (contents.subarray(0, 2).toString() === '#!' && contents.subarray(0, contents.indexOf(10)).includes(13)) {
        throw new Error(`Linux launcher has a CRLF shebang: ${file}`);
      }
    }
  }
}
verifyLinuxLaunchers(path.join(output, 'app'));
fs.writeFileSync(path.join(output, '.dockerignore'), '**/.git\n**/node_modules\n**/dist\n**/build\n**/.env\n**/.env.*\n!**/.env.example\n');
const manifest = { uiCommit, ...versions, appName: skillName, appHome };
fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output, ...manifest }, null, 2));
