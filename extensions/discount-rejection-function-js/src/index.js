import run from "@shopify/shopify_function/run";
import { cartLinesDiscountsGenerateRun as userFunction } from "./cart_lines_discounts_generate_run.js";

function cartLinesDiscountsGenerateRun() {
  return run(userFunction);
}

export { cartLinesDiscountsGenerateRun };
