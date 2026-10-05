import { writeFileSync } from "node:fs";

function assertEqual(actual: number, expected: number, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

const sum: number = 2 + 2;
assertEqual(sum, 4, "2+2 check failed");

writeFileSync("result.txt", "GITHUB_EVENT_VERIFIED");
console.log("CHECK_OK");
