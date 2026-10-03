const fs = require('fs');
const path = require('path');

const docsDir = path.join(__dirname, '..', 'docs', 'screens');
const outDir = path.join(__dirname, '..', 'apps', 'web', 'src', 'app');

const map = {
  '02-ai-sales-manager.md': 'ai-manager',
  '04-company-360-prospect-360.md': 'company-360',
  '05-conversations-ai-inbox.md': 'inbox',
  '06-campaigns.md': 'campaigns',
  '07-opportunities.md': 'opportunities',
  '08-calendar-meetings.md': 'meetings',
  '09-signals.md': 'signals',
  '10-analytics.md': 'analytics',
  '11-experiments.md': 'experiments',
  '12-ai-memory.md': 'memory',
  '13-knowledge-base.md': 'knowledge',
  '14-tasks-human-attention.md': 'tasks',
  '15-integrations.md': 'integrations',
  '16-team-roles-permissions.md': 'team',
  '17-ai-control-center.md': 'ai-control',
  '18-settings.md': 'settings',
};

for (const [file, folder] of Object.entries(map)) {
  const content = fs.readFileSync(path.join(docsDir, file), 'utf8');
  const lines = content.split('\n');
  let title = '';
  for (const line of lines) {
    if (line.startsWith('# ')) { title = line.replace('# ', '').trim(); break; }
  }
  let desc = '';
  for (let i = 0; i < lines.length; i++) {
    if (/##\s*(2|3)\.\s*(Structure|Layout|Core Purpose)/i.test(lines[i])) {
      for (let j = i + 1; j < lines.length && !lines[j].startsWith('##'); j++) {
        if (lines[j].trim().length > 0 && !lines[j].startsWith('|') && !lines[j].startsWith('```')) {
          desc += lines[j].trim() + ' ';
        }
      }
      break;
    }
  }
  desc = desc.replace(/\n/g, ' ').trim();
  const pagePath = path.join(outDir, folder, 'page.tsx');
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  const pageContent = `import PlaceholderScreen from "@/components/ui/PlaceholderScreen";\n\nexport default function Page() {\n  return (\n    <PlaceholderScreen\n      title="${title}"\n      description="${desc.replace(/"/g, '\\"')}"\n    />\n  );\n}\n`;
  fs.writeFileSync(pagePath, pageContent);
  console.log('Generated', pagePath);
}
