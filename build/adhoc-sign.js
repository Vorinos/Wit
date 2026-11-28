/* Runs after electron-builder packs the Mac app. Without a Developer ID certificate the app would ship with a broken
   signature, and on an Apple Silicon Mac a downloaded copy is then reported as "damaged". Signing it ad hoc instead
   means macOS asks once (System Settings > Privacy & Security > Open Anyway) and then opens it.
   With a real certificate (CSC_LINK or CSC_NAME set), electron-builder signs and notarizes it and this does nothing. */
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
