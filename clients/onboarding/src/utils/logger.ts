import { print as printQuery } from "@0no-co/graphql.web";
import { captureException, init } from "@sentry/react";
import { isNotNullish, isNullish } from "@swan-io/lake/src/utils/nullish";
import { CombinedError, Operation, OperationContext } from "urql";
import { env } from "./env";

const FORCE_DEV_LOGGING = false;

const ENABLED = env.IS_SWAN_MODE && (process.env.NODE_ENV === "production" || FORCE_DEV_LOGGING);

export const initSentry = () => {
  if (ENABLED) {
    init({
      release: env.VERSION,
      dsn: "https://632023ecffdc437984c7a53bbb3aa7a6@o427297.ingest.sentry.io/5454043",
      environment: env.BANKING_URL.includes("preprod")
        ? "preprod"
        : env.BANKING_URL.includes("master")
        ? "master"
        : "prod",
      normalizeDepth: 5,
    });
  }
};

const getOperationContextHeaders = (context: OperationContext): Record<string, string> => {
  const { headers } =
    typeof context.fetchOptions === "function"
      ? context.fetchOptions()
      : context.fetchOptions ?? {};

  if (isNullish(headers)) {
    return {};
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  return headers;
};

export const logFrontendError = (exception: unknown, extra?: Record<string, unknown>) => {
  if (ENABLED && !(exception instanceof CombinedError)) {
    captureException(exception, {
      extra,
      tags: { scope: "frontend" },
    });
  }
};

export const logBackendError = (
  { graphQLErrors }: CombinedError,
  { context, query, variables }: Operation,
) => {
  if (!ENABLED) {
    return;
  }

  const headers = getOperationContextHeaders(context);
  const existingHeaders = Object.keys(headers).filter(key => isNotNullish(headers[key]));
  const requestId = headers["x-request-id"];
  const hasMultipleErrors = graphQLErrors.length > 1;

  graphQLErrors.forEach(error => {
    if (
      hasMultipleErrors &&
      error.message.startsWith("Cannot return null for non-nullable field")
    ) {
      return;
    }

    if (isNotNullish(requestId)) {
      // Mutate the error message to prepend the requestId
      error.message = `${requestId} - ${error.message}`;
    }

    captureException(error, {
      tags: {
        scope: "backend",
        endpoint: context.url,
      },
      extra: {
        headers: existingHeaders,
        query: printQuery(query),
        requestPolicy: context.requestPolicy,
        suspense: context.suspense,
        variables, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      },
    });
  });
};
