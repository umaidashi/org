import { runSemanticReview } from './semantic-review.ts';

try {
  runSemanticReview(process.cwd(), process.cwd());
} catch (error) {
  console.error(`Semantic gate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
