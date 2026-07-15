import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateOpenApiContract } from "../../scripts/validate-openapi.mjs";

export async function createOpenApiResponseValidator() {
  const contract = await validateOpenApiContract();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  return async function assertContract(response, path, method) {
    const schema =
      contract.paths[path][method].responses[String(response.status)].content[
        "application/json"
      ].schema;
    const validate = ajv.compile(schema);
    const body = await response.clone().json();
    assert.equal(
      validate(body),
      true,
      `${method.toUpperCase()} ${path} ${response.status}: ${ajv.errorsText(validate.errors)}`,
    );
  };
}
