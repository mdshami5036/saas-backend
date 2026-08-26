const fs = require('fs');
const path = require('path');

const startupDir = path.join(
  process.env.APPDATA,
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup'
);

console.log('Checking startup directory:', startupDir);

const filesToRemove = [
  'AutoPrint_Boot.vbs',
  'SaaSPrintAgent.vbs',
];

filesToRemove.forEach((filename) => {
  const fullPath = path.join(startupDir, filename);
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      console.log('Successfully removed:', filename);
    } catch (e) {
      console.error('Failed to remove:', filename, e.message);
    }
  } else {
    console.log('File does not exist:', filename);
  }
});

// Ensure WevePrintAgent.vbs exists and runs 100% silent in background
const weveVbsPath = path.join(startupDir, 'WevePrintAgent.vbs');
const weveVbsContent = `Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = "C:\\Users\\mdsha\\AppData\\Local\\WevePrintAgent"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir
agentJs = Chr(34) & scriptDir & "\\src\\agent.js" & Chr(34)
WshShell.Run "node.exe " & agentJs, 0, False
`;

fs.writeFileSync(weveVbsPath, weveVbsContent, 'utf8');
console.log('Updated WevePrintAgent.vbs for 100% silent background execution.');

console.log('Current files in Startup folder:');
fs.readdirSync(startupDir).forEach((file) => console.log(' -', file));
