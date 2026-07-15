import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultContractUrl = new URL("../openapi/openapi.yaml", import.meta.url);
const httpMethods = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);

function inputForParser(source) {
  return source instanceof URL ? fileURLToPath(source) : source;
}

function exampleEntries(mediaType) {
  const entries = [];
  if (Object.hasOwn(mediaType, "example")) {
    entries.push(["example", mediaType.example]);
  }
  for (const [name, example] of Object.entries(mediaType.examples ?? {})) {
    if (example && Object.hasOwn(example, "value")) {
      entries.push([`examples.${name}`, example.value]);
    }
  }
  return entries;
}

function validateExamples(contract) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  function validateMediaType(mediaType, location) {
    if (!mediaType?.schema) return;
    const validate = ajv.compile(mediaType.schema);
    for (const [name, value] of exampleEntries(mediaType)) {
      if (!validate(value)) {
        throw new Error(
          `${location}.${name} is invalid: ${ajv.errorsText(validate.errors, {
            dataVar: "example",
          })}`,
        );
      }
    }
  }

  function validateContent(content, location) {
    for (const [mediaTypeName, mediaType] of Object.entries(content ?? {})) {
      validateMediaType(mediaType, `${location}.content.${mediaTypeName}`);
    }
  }

  function validateParameter(parameter, location) {
    if (!parameter?.schema) return;
    const validate = ajv.compile(parameter.schema);
    for (const [name, value] of exampleEntries(parameter)) {
      if (!validate(value)) {
        throw new Error(
          `${location}.${name} is invalid: ${ajv.errorsText(validate.errors, {
            dataVar: "example",
          })}`,
        );
      }
    }
  }

  for (const [name, response] of Object.entries(contract.components?.responses ?? {})) {
    validateContent(response.content, `components.responses.${name}`);
  }
  for (const [name, requestBody] of Object.entries(
    contract.components?.requestBodies ?? {},
  )) {
    validateContent(requestBody.content, `components.requestBodies.${name}`);
  }
  for (const [name, parameter] of Object.entries(
    contract.components?.parameters ?? {},
  )) {
    validateParameter(parameter, `components.parameters.${name}`);
  }

  for (const [path, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const [index, parameter] of (pathItem.parameters ?? []).entries()) {
      validateParameter(parameter, `paths.${path}.parameters.${index}`);
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!httpMethods.has(method)) continue;
      const location = `paths.${path}.${method}`;
      validateContent(operation.requestBody?.content, `${location}.requestBody`);
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        validateContent(response.content, `${location}.responses.${status}`);
      }
      for (const [index, parameter] of (operation.parameters ?? []).entries()) {
        validateParameter(parameter, `${location}.parameters.${index}`);
      }
    }
  }
}

function validateOperationShapes(contract) {
  const operationIds = new Set();
  for (const [path, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!httpMethods.has(method)) continue;
      const location = `${method.toUpperCase()} ${path}`;
      if (!operation.operationId) {
        throw new Error(`${location} must declare an operationId.`);
      }
      if (operationIds.has(operation.operationId)) {
        throw new Error(`${location} repeats operationId ${operation.operationId}.`);
      }
      operationIds.add(operation.operationId);
      if (!operation.responses || Object.keys(operation.responses).length === 0) {
        throw new Error(`${location} must declare responses.`);
      }
    }
  }
}

export async function validateOpenApiContract(source = defaultContractUrl) {
  let contract;
  try {
    contract = await SwaggerParser.validate(inputForParser(source));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Not a valid OpenAPI contract: ${message}`, { cause: error });
  }
  validateOperationShapes(contract);
  validateExamples(contract);
  return contract;
}

function isMainModule() {
  return Boolean(
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
  );
}

if (isMainModule()) {
  const contract = await validateOpenApiContract();
  const operationCount = Object.values(contract.paths).reduce(
    (count, pathItem) =>
      count + Object.keys(pathItem).filter((method) => httpMethods.has(method)).length,
    0,
  );
  process.stdout.write(
    `OpenAPI contract valid: ${Object.keys(contract.paths).length} paths, ${operationCount} operations.\n`,
  );
}
