import type { Messages } from "@/i18n/messages";

// Test if the conflict properties exist on Messages["results"]
type Test = Messages["results"] extends { conflictOpenTitle: string } ? true : false;
const test: Test = true;
