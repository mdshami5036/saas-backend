const fs = require('fs');
const path = require('path');

const srcExe = 'C:\\Users\\mdsha\\AppData\\Local\\WevePrintAgent\\WevePrint-Agent.exe';

const destinations = [
  'C:\\Users\\mdsha\\AppData\\Local\\WevePrintAgent\\PrintAgent.exe',
  'C:\\Users\\mdsha\\Desktop\\Antigravity\\malti print center\\public\\WevePrint-Agent.exe',
  'C:\\Users\\mdsha\\Desktop\\Antigravity\\malti print center\\public\\PrintAgent.exe',
  'C:\\Users\\mdsha\\Downloads\\WevePrint-Agent.exe',
  'C:\\Users\\mdsha\\Downloads\\PrintAgent.exe',
];

if (!fs.existsSync(srcExe)) {
  console.error('Source executable not found:', srcExe);
  process.exit(1);
}

const stats = fs.statSync(srcExe);
console.log(`Source EXE Size: ${stats.size} bytes`);

destinations.forEach((dest) => {
  try {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.copyFileSync(srcExe, dest);
    console.log('Successfully deployed to:', dest);
  } catch (e) {
    console.error('Failed to copy to:', dest, e.message);
  }
});

console.log('Agent binary deployment complete!');
