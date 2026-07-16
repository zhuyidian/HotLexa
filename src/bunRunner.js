export function buildBunCommand(runtimeArgs = []) {
  if (process.platform === "win32") {
    const commandLine = ["npx.cmd", "-y", "bun", ...runtimeArgs]
      .map((arg, index) => (index === 0 ? arg : quoteCmdArg(arg)))
      .join(" ");
    return {
      bin: "cmd.exe",
      args: ["/d", "/s", "/c", commandLine]
    };
  }

  return {
    bin: "npx",
    args: ["-y", "bun", ...runtimeArgs]
  };
}

export function formatSpawnError(result) {
  if (result.error) {
    return `${result.error.code || result.error.name || "spawn error"}: ${result.error.message}`;
  }
  return result.stderr || result.stdout || `exit ${result.status}`;
}

export function formatCommand(command) {
  return [command.bin, ...command.args].join(" ");
}

function quoteCmdArg(value) {
  const text = String(value ?? "");
  if (!text) return "\"\"";
  const escaped = text
    .replace(/%/g, "%%%%")
    // npx.cmd is a batch file. cmd.exe parses these characters once before
    // invoking it, and npx.cmd parses them again before starting Bun.
    .replace(/[\^&|<>()!]/g, "^^^$&");

  if (/\s/.test(escaped)) {
    return `"${escaped.replace(/"/g, "\\\"")}"`;
  }
  return escaped;
}
