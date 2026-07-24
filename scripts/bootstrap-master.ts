import { createMaster } from "@/server/services/masterAuthService";

interface ParsedArgs {
  masterId?: string;
  email?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--master-id") result.masterId = argv[(i += 1)];
    else if (argv[i] === "--email") result.email = argv[(i += 1)];
  }
  return result;
}

async function main(): Promise<void> {
  const { masterId, email } = parseArgs(process.argv.slice(2));

  if (!masterId || !email) {
    console.error("Usage: bootstrap-master --master-id <id> --email <operational email>");
    process.exitCode = 1;
    return;
  }

  const result = await createMaster({ masterId, email, createdByMasterId: null });

  if (result.ok) {
    console.log(`Created MASTER ${result.master.masterId} (${result.master.id}).`);
    console.log(`Temporary password (shown once): ${result.temporaryPassword}`);
    return;
  }

  switch (result.reason) {
    case "bootstrap_already_completed":
      console.error("Error: a MASTER identity already exists — bootstrap runs exactly once.");
      break;
    case "invalid_master_id":
      console.error("Error: masterId is blank, too long, or contains invalid characters.");
      break;
    case "invalid_email":
      console.error(`Error: not a valid email address (${email}).`);
      break;
    case "master_id_already_in_use":
      console.error(`Error: masterId already in use (${masterId}).`);
      break;
    case "email_already_in_use":
      console.error(`Error: email already in use (${email}).`);
      break;
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
