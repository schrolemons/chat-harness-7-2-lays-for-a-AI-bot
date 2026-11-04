import { spawn } from 'node:child_process';

const consoleWriter = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
public sealed class SetupViewer : Form {
  // Open in the background; the user can still click the window to copy text.
  protected override bool ShowWithoutActivation { get { return true; } }
  private SetupViewer(Stream input, string title) {
    Text = title;
    StartPosition = FormStartPosition.CenterScreen;
    ClientSize = new Size(710, 190);
    var output = new TextBox {
      Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
      BackColor = Color.FromArgb(16, 16, 16), ForeColor = Color.Gainsboro,
      Font = new Font("Consolas", 11)
    };
    Controls.Add(output);
    Load += (sender, args) => {
      new Thread(() => {
        try {
          using (var reader = new StreamReader(input, Encoding.UTF8)) {
            string line;
            while ((line = reader.ReadLine()) != null) {
              string text = line + Environment.NewLine;
              BeginInvoke((Action)(() => output.AppendText(text)));
            }
          }
        } catch (IOException) {
        } catch (InvalidOperationException) {
          return;
        }
        try { BeginInvoke((Action)Close); } catch (InvalidOperationException) {}
      }) { IsBackground = true }.Start();
    };
  }
  public static void Run(Stream input, string title) {
    Application.EnableVisualStyles();
    Application.Run(new SetupViewer(input, title));
  }
}
'@
[SetupViewer]::Run([Console]::OpenStandardInput(), $env:QQ_SETUP_VIEWER_TITLE)
`;

export function openSetupViewer(title, lines, onUnavailable) {
  const writer = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-STA',
    '-EncodedCommand', Buffer.from(consoleWriter, 'utf16le').toString('base64'),
  ], {
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: { ...process.env, QQ_SETUP_VIEWER_TITLE: title },
  });
  writer.once('error', onUnavailable);
  writer.once('exit', code => { if (code !== 0) onUnavailable(); });
  writer.stdin.on('error', () => {});
  writer.stdin.write(lines.join('\n') + '\n');
  return writer;
}
