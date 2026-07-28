// Hook de firma para electron-builder (win.sign).
// Reutiliza infra/release/windows/sign-artifact.ps1: firma con Authenticode
// si hay certificado configurado por variables de entorno; si no, no-op (dev).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function sign(configuration) {
  const filePath = configuration.path;
  if (!filePath) return;

  const script = path.resolve(
    __dirname,
    "..", "..", "..",
    "infra", "release", "windows", "sign-artifact.ps1",
  );

  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Path", filePath],
    { stdio: "inherit" },
  );
};
