// Server entry point of rules: other parts import rules' server code only through this file.
import "server-only";

export { createRules, type Rules } from "./create-rules";
