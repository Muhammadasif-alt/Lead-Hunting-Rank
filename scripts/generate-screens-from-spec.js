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

function extractSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('# ')) {
      current = line.replace('# ', '').trim();
      sections.push({ title: current, body: '' });
    } else if (line.startsWith('## ') && current) {
      sections.push({ title: line.replace('## ', '').trim(), body: '' });
      current = line.replace('## ', '').trim();
    } else if (current && line.trim().length > 0 && !line.startsWith('```')) {
      sections[sections.length - 1].body += line + '\n';
    }
  }
  return sections;
}

for (const [file, folder] of Object.entries(map)) {
  const content = fs.readFileSync(path.join(docsDir, file), 'utf8');
  const sections = extractSections(content);
  const pagePath = path.join(outDir, folder, 'page.tsx');
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  let secJsx = '';
  for (const sec of sections) {
    const safe = sec.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
    secJsx += `<div className="card p-4"><div className="text-sm font-semibold">${sec.title}</div><pre className="mt-2 text-xs text-[#7cbfa0] whitespace-pre-wrap">{${JSON.stringify(sec.body.trim())}}</pre></div>`;
  }
  const pageContent = 'import ScreenPage from "@/components/ui/ScreenPage";\nexport default function Page() {\n  const sections = ' + JSON.stringify(sections) + ';\n  return <ScreenPage title=' + JSON.stringify(sections[0].title) + ' sections={sections} />;\n}\n';
  fs.writeFileSync(pagePath, pageContent);
  console.log('Generated', pagePath);
}
