import { createCommunity } from "@/server/services/communityService";

interface ParsedArgs {
  name?: string;
  email?: string;
  operator?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--name") result.name = argv[(i += 1)];
    else if (argv[i] === "--email") result.email = argv[(i += 1)];
    else if (argv[i] === "--operator") result.operator = argv[(i += 1)];
  }
  return result;
}

async function main(): Promise<void> {
  const { name, email, operator } = parseArgs(process.argv.slice(2));

  if (!name || !email || !operator) {
    console.error(
      "Usage: create-community --name <community name> --email <founder's verified account email> --operator <your identifier>",
    );
    process.exitCode = 1;
    return;
  }

  const result = await createCommunity({ name, founderEmail: email, invokedBy: operator });

  if (result.ok) {
    console.log(
      `Created community ${result.community.id} ("${result.community.name}") at ${result.community.createdAt.toISOString()}`,
    );
    return;
  }

  switch (result.reason) {
    case "account_not_found":
      console.error(`Error: no account found for that email (${email}).`);
      break;
    case "account_not_verified":
      console.error(`Error: that account's email is not verified yet (${email}).`);
      break;
    case "invalid_name":
      console.error("Error: the community name cannot be blank.");
      break;
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
