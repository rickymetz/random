// @netlify/blobs 11.1.1 (MIT, https://github.com/netlify/primitives), bundled into one
// file with esbuild so the Jellybrawl function needs no package.json or install
// step (the hub ships no dependency manifest). Regenerate:
//   echo 'export { getStore } from "@netlify/blobs";' > e.mjs &&
//   npx esbuild e.mjs --bundle --format=esm --platform=node --target=node18 --minify-syntax --outfile=netlify/vendor/netlify-blobs.mjs
/* eslint-disable */
// node_modules/@netlify/runtime-utils/dist/main.js
var getString = (input) => typeof input == "string" ? input : JSON.stringify(input), base64Decode = globalThis.Buffer ? (input) => Buffer.from(input, "base64").toString() : (input) => atob(input), base64Encode = globalThis.Buffer ? (input) => Buffer.from(getString(input)).toString("base64") : (input) => btoa(getString(input)), getEnvironment = () => {
  let { Deno, Netlify, process } = globalThis;
  return Netlify?.env ?? Deno?.env ?? {
    delete: (key) => delete process?.env[key],
    get: (key) => process?.env[key],
    has: (key) => !!process?.env[key],
    set: (key, value) => {
      process?.env && (process.env[key] = value);
    },
    toObject: () => process?.env ?? {}
  };
};

// node_modules/@netlify/otel/dist/main.js
var GET_TRACER = "__netlify__getTracer";
var getTracer = (name, version) => globalThis[GET_TRACER]?.(name, version);
function withActiveSpan(tracer, name, optionsOrFn, contextOrFn, fn) {
  let func = typeof contextOrFn == "function" ? contextOrFn : typeof optionsOrFn == "function" ? optionsOrFn : fn;
  if (!func)
    throw new Error("function to execute with active span is missing");
  return tracer ? tracer.withActiveSpan(name, optionsOrFn, contextOrFn, func) : func();
}

// node_modules/@netlify/blobs/dist/chunk-6TDSNTDP.js
var getEnvironmentContext = () => {
  let context = globalThis.netlifyBlobsContext || getEnvironment().get("NETLIFY_BLOBS_CONTEXT");
  if (typeof context != "string" || !context)
    return {};
  let data = base64Decode(context);
  try {
    return JSON.parse(data);
  } catch {
  }
  return {};
};
var MissingBlobsEnvironmentError = class extends Error {
  constructor(requiredProperties) {
    super(
      `The environment has not been configured to use Netlify Blobs. To use it manually, supply the following properties when creating a store: ${requiredProperties.join(
        ", "
      )}`
    ), this.name = "MissingBlobsEnvironmentError";
  }
}, BASE64_PREFIX = "b64;", METADATA_HEADER_INTERNAL = "x-amz-meta-user", METADATA_HEADER_EXTERNAL = "netlify-blobs-metadata", METADATA_MAX_SIZE = 2 * 1024, encodeMetadata = (metadata) => {
  if (!metadata)
    return null;
  let payload = `b64;${base64Encode(JSON.stringify(metadata))}`;
  if (METADATA_HEADER_EXTERNAL.length + payload.length > METADATA_MAX_SIZE)
    throw new Error("Metadata object exceeds the maximum size");
  return payload;
}, decodeMetadata = (header) => {
  if (!header?.startsWith(BASE64_PREFIX))
    return {};
  let encodedData = header.slice(BASE64_PREFIX.length), decodedData = base64Decode(encodedData);
  return JSON.parse(decodedData);
}, getMetadataFromResponse = (response) => {
  if (!response.headers)
    return {};
  let value = response.headers.get(METADATA_HEADER_EXTERNAL) || response.headers.get(METADATA_HEADER_INTERNAL);
  try {
    return decodeMetadata(value);
  } catch {
    throw new Error(
      "An internal error occurred while trying to retrieve the metadata for an entry. Please try updating to the latest version of the Netlify Blobs client."
    );
  }
}, NF_ERROR = "x-nf-error", NF_REQUEST_ID = "x-nf-request-id", DEPLOY_STORE_PREFIX = "deploy:", SITE_STORE_PREFIX = "site:", isDeniedWrite = (res, { method, storeName }) => (res.status === 401 || res.status === 403) && (method === "put" || method === "delete") && storeName !== void 0 && !storeName.startsWith(DEPLOY_STORE_PREFIX), blobsErrorMessage = (res, context, responseBody) => {
  let details = res.headers.get(NF_ERROR) || `${res.status} status code`;
  if (res.headers.has(NF_REQUEST_ID) && (details += `, ID: ${res.headers.get(NF_REQUEST_ID)}`), isDeniedWrite(res, context))
    return `Netlify Blobs could not write to store '${context.storeName?.startsWith(SITE_STORE_PREFIX) ? context.storeName.slice(SITE_STORE_PREFIX.length) : context.storeName}' (${details}). Builds and build plugins can only write to deploy-specific stores: use 'getDeployStore' instead of 'getStore', or pass a 'token' with write access to the store. If this code is not running in a build, check that the token and site ID are valid. See https://docs.netlify.com/build/data-and-storage/netlify-blobs/#deploy-specific-stores`;
  let message = `Netlify Blobs has generated an internal error (${details})`;
  return !res.headers.get(NF_ERROR) && responseBody && (message += `: ${responseBody}`), message;
}, BlobsInternalError = class extends Error {
  constructor(res, context = {}, responseBody) {
    super(blobsErrorMessage(res, context, responseBody)), this.name = "BlobsInternalError", this.status = res.status, this.responseBody = responseBody;
  }
}, createBlobsInternalError = async (res, context = {}) => {
  let responseBody = await res.clone().text().catch(() => {
  });
  return new BlobsInternalError(res, context, responseBody);
}, collectIterator = async (iterator) => {
  let result = [];
  for await (let item of iterator)
    result.push(item);
  return result;
};
function withSpan(span, name, fn) {
  return span ? fn(span) : withActiveSpan(getTracer(), name, (span2) => fn(span2));
}
var BlobsConsistencyError = class extends Error {
  constructor() {
    super(
      "Netlify Blobs has failed to perform a read using strong consistency because the environment has not been configured with a 'uncachedEdgeURL' property"
    ), this.name = "BlobsConsistencyError";
  }
}, REGION_AUTO = "auto", regions = {
  "us-east-1": !0,
  "us-east-2": !0,
  "eu-central-1": !0,
  "ap-southeast-1": !0,
  "ap-southeast-2": !0
}, isValidRegion = (input) => Object.keys(regions).includes(input), InvalidBlobsRegionError = class extends Error {
  constructor(region) {
    super(
      `${region} is not a supported Netlify Blobs region. Supported values are: ${Object.keys(regions).join(", ")}.`
    ), this.name = "InvalidBlobsRegionError";
  }
}, DEFAULT_RETRY_DELAY = getEnvironment().get("NODE_ENV") === "test" ? 1 : 5e3, MIN_RETRY_DELAY = 1e3, MAX_RETRY = 5, RATE_LIMIT_HEADER = "X-RateLimit-Reset", fetchAndRetry = async (fetch, url, options, attemptsLeft = MAX_RETRY, getRetryUrl) => {
  try {
    let res = await fetch(url, options), isRetryable = res.status === 429 || res.status >= 500 || getRetryUrl !== void 0 && res.status === 403;
    if (attemptsLeft > 0 && isRetryable) {
      let delay = getDelay(res.headers.get(RATE_LIMIT_HEADER));
      await sleep(delay);
      let retryUrl = getRetryUrl ? await getRetryUrl() : url;
      return fetchAndRetry(fetch, retryUrl, options, attemptsLeft - 1, getRetryUrl);
    }
    return res;
  } catch (error) {
    if (attemptsLeft === 0)
      throw error;
    let delay = getDelay();
    await sleep(delay);
    let retryUrl = getRetryUrl ? await getRetryUrl() : url;
    return fetchAndRetry(fetch, retryUrl, options, attemptsLeft - 1, getRetryUrl);
  }
}, getDelay = (rateLimitReset) => rateLimitReset ? Math.max(Number(rateLimitReset) * 1e3 - Date.now(), MIN_RETRY_DELAY) : DEFAULT_RETRY_DELAY, sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
}), SIGNED_URL_ACCEPT_HEADER = "application/json;type=signed-url", Client = class {
  constructor({ apiURL, consistency, edgeURL, fetch, region, siteID, token, uncachedEdgeURL }) {
    if (this.apiURL = apiURL, this.consistency = consistency ?? "eventual", this.edgeURL = edgeURL, this.fetch = fetch ?? globalThis.fetch, this.region = region, this.siteID = siteID, this.token = token, this.uncachedEdgeURL = uncachedEdgeURL, !this.fetch)
      throw new Error(
        "Netlify Blobs could not find a `fetch` client in the global scope. You can either update your runtime to a version that includes `fetch` (like Node.js 18.0.0 or above), or you can supply your own implementation using the `fetch` property."
      );
  }
  async getFinalRequest({
    consistency: opConsistency,
    key,
    metadata,
    method,
    parameters = {},
    storeName
  }) {
    let encodedMetadata = encodeMetadata(metadata), consistency = opConsistency ?? this.consistency, urlPath = `/${this.siteID}`;
    if (storeName && (urlPath += `/${storeName}`), key && (urlPath += `/${key}`), this.edgeURL) {
      if (consistency === "strong" && !this.uncachedEdgeURL)
        throw new BlobsConsistencyError();
      let headers = {
        authorization: `Bearer ${this.token}`
      };
      encodedMetadata && (headers[METADATA_HEADER_INTERNAL] = encodedMetadata), this.region && (urlPath = `/region:${this.region}${urlPath}`);
      let url2 = new URL(urlPath, consistency === "strong" ? this.uncachedEdgeURL : this.edgeURL);
      for (let key2 in parameters)
        url2.searchParams.set(key2, parameters[key2]);
      return {
        headers,
        url: url2.toString()
      };
    }
    let apiHeaders = { authorization: `Bearer ${this.token}` }, url = new URL(`/api/v1/blobs${urlPath}`, this.apiURL ?? "https://api.netlify.com");
    for (let key2 in parameters)
      url.searchParams.set(key2, parameters[key2]);
    if (this.region && url.searchParams.set("region", this.region), storeName === void 0 || key === void 0)
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    if (encodedMetadata && (apiHeaders[METADATA_HEADER_EXTERNAL] = encodedMetadata), method === "head" || method === "delete")
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    let res = await this.fetch(url.toString(), {
      headers: { ...apiHeaders, accept: SIGNED_URL_ACCEPT_HEADER },
      method
    });
    if (res.status !== 200)
      throw await createBlobsInternalError(res, { method, storeName });
    let { url: signedURL } = await res.json();
    return {
      headers: encodedMetadata ? { [METADATA_HEADER_INTERNAL]: encodedMetadata } : void 0,
      url: signedURL
    };
  }
  async makeRequest({
    body,
    conditions = {},
    consistency,
    headers: extraHeaders,
    key,
    metadata,
    method,
    parameters,
    storeName
  }) {
    let { headers: baseHeaders = {}, url } = await this.getFinalRequest({
      consistency,
      key,
      metadata,
      method,
      parameters,
      storeName
    }), headers = {
      ...baseHeaders,
      ...extraHeaders
    };
    method === "put" && (headers["cache-control"] = "max-age=0, stale-while-revalidate=60"), "onlyIfMatch" in conditions && conditions.onlyIfMatch ? headers["if-match"] = conditions.onlyIfMatch : "onlyIfNew" in conditions && conditions.onlyIfNew && (headers["if-none-match"] = "*");
    let options = {
      body,
      headers,
      method
    };
    body instanceof ReadableStream && (options.duplex = "half");
    let usesSignedUrl = !this.edgeURL && key !== void 0 && storeName !== void 0 && method !== "head" && method !== "delete", getRetryUrl;
    return usesSignedUrl && (getRetryUrl = async () => (await this.getFinalRequest({ consistency, key, metadata, method, parameters, storeName })).url), fetchAndRetry(this.fetch, url, options, void 0, getRetryUrl);
  }
}, getClientOptions = (options, contextOverride) => {
  let context = contextOverride ?? getEnvironmentContext(), siteID = context.siteID ?? options.siteID, token = context.token ?? options.token;
  if (!siteID || !token)
    throw new MissingBlobsEnvironmentError(["siteID", "token"]);
  if (options.region !== void 0 && !isValidRegion(options.region))
    throw new InvalidBlobsRegionError(options.region);
  return {
    apiURL: context.apiURL ?? options.apiURL,
    consistency: options.consistency,
    edgeURL: context.edgeURL ?? options.edgeURL,
    fetch: options.fetch,
    region: options.region,
    siteID,
    token,
    uncachedEdgeURL: context.uncachedEdgeURL ?? options.uncachedEdgeURL
  };
};

// node_modules/@netlify/blobs/dist/main.js
var LEGACY_STORE_INTERNAL_PREFIX = "netlify-internal/legacy-namespace/", STATUS_OK = 200, STATUS_PRE_CONDITION_FAILED = 412, Store = class _Store {
  constructor(options) {
    if (this.client = options.client, "deployID" in options) {
      _Store.validateDeployID(options.deployID);
      let name = DEPLOY_STORE_PREFIX + options.deployID;
      options.name && (name += `:${options.name}`), this.name = name;
    } else if (options.name.startsWith(LEGACY_STORE_INTERNAL_PREFIX)) {
      let storeName = options.name.slice(LEGACY_STORE_INTERNAL_PREFIX.length);
      _Store.validateStoreName(storeName), this.name = storeName;
    } else
      _Store.validateStoreName(options.name), this.name = SITE_STORE_PREFIX + options.name;
  }
  async delete(key) {
    let res = await this.client.makeRequest({ key, method: "delete", storeName: this.name });
    if (![200, 204, 404].includes(res.status))
      throw new BlobsInternalError(res, { method: "delete", storeName: this.name });
  }
  async deleteAll() {
    let totalDeletedBlobs = 0, hasMore = !0;
    for (; hasMore; ) {
      let res = await this.client.makeRequest({ method: "delete", storeName: this.name });
      if (res.status !== 200)
        throw new BlobsInternalError(res, { method: "delete", storeName: this.name });
      let data = await res.json();
      if (typeof data.blobs_deleted != "number")
        throw new BlobsInternalError(res);
      totalDeletedBlobs += data.blobs_deleted, hasMore = typeof data.has_more == "boolean" && data.has_more;
    }
    return {
      deletedBlobs: totalDeletedBlobs
    };
  }
  async get(key, options) {
    return withSpan(options?.span, "blobs.get", async (span) => {
      let { consistency, type } = options ?? {};
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.type": type,
        "blobs.method": "GET",
        "blobs.consistency": consistency
      });
      let res = await this.client.makeRequest({
        consistency,
        key,
        method: "get",
        storeName: this.name
      });
      if (span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.status": res.status
      }), res.status === 404)
        return null;
      if (res.status !== 200)
        throw new BlobsInternalError(res);
      if (type === void 0 || type === "text")
        return res.text();
      if (type === "arrayBuffer")
        return res.arrayBuffer();
      if (type === "blob")
        return res.blob();
      if (type === "json")
        return res.json();
      if (type === "stream")
        return res.body;
      throw new BlobsInternalError(res);
    });
  }
  async getMetadata(key, options = {}) {
    return withSpan(options?.span, "blobs.getMetadata", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "HEAD",
        "blobs.consistency": options.consistency
      });
      let res = await this.client.makeRequest({
        consistency: options.consistency,
        key,
        method: "head",
        storeName: this.name
      });
      if (span?.setAttributes({
        "blobs.response.status": res.status
      }), res.status === 404)
        return null;
      if (res.status !== 200 && res.status !== 304)
        throw new BlobsInternalError(res);
      let etag = res?.headers.get("etag") ?? void 0, metadata = getMetadataFromResponse(res);
      return {
        etag,
        metadata
      };
    });
  }
  async getWithMetadata(key, options) {
    return withSpan(options?.span, "blobs.getWithMetadata", async (span) => {
      let { consistency, etag: requestETag, type } = options ?? {}, headers = requestETag ? { "if-none-match": requestETag } : void 0;
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "GET",
        "blobs.consistency": options?.consistency,
        "blobs.type": type,
        "blobs.request.etag": requestETag
      });
      let res = await this.client.makeRequest({
        consistency,
        headers,
        key,
        method: "get",
        storeName: this.name
      }), responseETag = res?.headers.get("etag") ?? void 0;
      if (span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.etag": responseETag,
        "blobs.response.status": res.status
      }), res.status === 404)
        return null;
      if (res.status !== 200 && res.status !== 304)
        throw new BlobsInternalError(res);
      let metadata = getMetadataFromResponse(res), result = {
        etag: responseETag,
        metadata
      };
      if (res.status === 304 && requestETag)
        return { data: null, ...result };
      if (type === void 0 || type === "text")
        return { data: await res.text(), ...result };
      if (type === "arrayBuffer")
        return { data: await res.arrayBuffer(), ...result };
      if (type === "blob")
        return { data: await res.blob(), ...result };
      if (type === "json")
        return { data: await res.json(), ...result };
      if (type === "stream")
        return { data: res.body, ...result };
      throw new Error(`Invalid 'type' property: ${type}. Expected: arrayBuffer, blob, json, stream, or text.`);
    });
  }
  list(options = {}) {
    return withSpan(options.span, "blobs.list", (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.method": "GET",
        "blobs.list.paginate": options.paginate ?? !1
      });
      let iterator = this.getListIterator(options);
      return options.paginate ? iterator : collectIterator(iterator).then(
        (items) => items.reduce(
          (acc, item) => ({
            blobs: [...acc.blobs, ...item.blobs],
            directories: [...acc.directories, ...item.directories]
          }),
          { blobs: [], directories: [] }
        )
      );
    });
  }
  async set(key, data, options = {}) {
    return withSpan(options.span, "blobs.set", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.size": typeof data == "string" ? data.length : data instanceof Blob ? data.size : data.byteLength,
        "blobs.data.type": typeof data == "string" ? "string" : data instanceof Blob ? "blob" : "arrayBuffer",
        "blobs.atomic": !!(options.onlyIfMatch ?? options.onlyIfNew)
      }), _Store.validateKey(key);
      let conditions = _Store.getConditions(options), res = await this.client.makeRequest({
        conditions,
        body: data,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      }), etag = res.headers.get("etag") ?? "";
      if (span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      }), conditions)
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: !1 } : { etag, modified: !0 };
      if (res.status === STATUS_OK)
        return {
          etag,
          modified: !0
        };
      throw await createBlobsInternalError(res, { method: "put", storeName: this.name });
    });
  }
  async setJSON(key, data, options = {}) {
    return withSpan(options.span, "blobs.setJSON", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.type": "json",
        "blobs.atomic": !!(options.onlyIfMatch ?? options.onlyIfNew)
      }), _Store.validateKey(key);
      let conditions = _Store.getConditions(options), payload = JSON.stringify(data), headers = {
        "content-type": "application/json"
      }, res = await this.client.makeRequest({
        conditions,
        body: payload,
        headers,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      }), etag = res.headers.get("etag") ?? "";
      if (span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      }), conditions)
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: !1 } : { etag, modified: !0 };
      if (res.status === STATUS_OK)
        return {
          etag,
          modified: !0
        };
      throw new BlobsInternalError(res, { method: "put", storeName: this.name });
    });
  }
  static formatListResultBlob(result) {
    return result.key ? {
      etag: result.etag,
      key: result.key
    } : null;
  }
  static getConditions(options) {
    if ("onlyIfMatch" in options && "onlyIfNew" in options)
      throw new Error(
        "The 'onlyIfMatch' and 'onlyIfNew' options are mutually exclusive. Using 'onlyIfMatch' will make the write succeed only if there is an entry for the key with the given content, while 'onlyIfNew' will make the write succeed only if there is no entry for the key."
      );
    if ("onlyIfMatch" in options && options.onlyIfMatch) {
      if (typeof options.onlyIfMatch != "string")
        throw new Error("The 'onlyIfMatch' property expects a string representing an ETag.");
      return {
        onlyIfMatch: options.onlyIfMatch
      };
    }
    if ("onlyIfNew" in options && options.onlyIfNew) {
      if (typeof options.onlyIfNew != "boolean")
        throw new Error(
          "The 'onlyIfNew' property expects a boolean indicating whether the write should fail if an entry for the key already exists."
        );
      return {
        onlyIfNew: !0
      };
    }
  }
  static validateKey(key) {
    if (key === "")
      throw new Error("Blob key must not be empty.");
    if (key.startsWith("/") || key.startsWith("%2F"))
      throw new Error("Blob key must not start with forward slash (/).");
    if (new TextEncoder().encode(key).length > 600)
      throw new Error(
        "Blob key must be a sequence of Unicode characters whose UTF-8 encoding is at most 600 bytes long."
      );
  }
  static validateDeployID(deployID) {
    if (!/^\w{1,24}$/.test(deployID))
      throw new Error(`'${deployID}' is not a valid Netlify deploy ID.`);
  }
  static validateStoreName(name) {
    if (name.includes("/") || name.includes("%2F"))
      throw new Error("Store name must not contain forward slashes (/).");
    if (new TextEncoder().encode(name).length > 64)
      throw new Error(
        "Store name must be a sequence of Unicode characters whose UTF-8 encoding is at most 64 bytes long."
      );
  }
  getListIterator(options) {
    let { client, name: storeName } = this, parameters = {};
    return options?.prefix && (parameters.prefix = options.prefix), options?.directories && (parameters.directories = "true"), {
      [Symbol.asyncIterator]() {
        let currentCursor = null, done = !1;
        return {
          async next() {
            return withSpan(options?.span, "blobs.list.next", async (span) => {
              if (span?.setAttributes({
                "blobs.store": storeName,
                "blobs.method": "GET",
                "blobs.list.paginate": options?.paginate ?? !1,
                "blobs.list.done": done,
                "blobs.list.cursor": currentCursor ?? void 0
              }), done)
                return { done: !0, value: void 0 };
              let nextParameters = { ...parameters };
              currentCursor !== null && (nextParameters.cursor = currentCursor);
              let res = await client.makeRequest({
                method: "get",
                parameters: nextParameters,
                storeName
              });
              span?.setAttributes({
                "blobs.response.status": res.status
              });
              let blobs = [], directories = [];
              if (![200, 204, 404].includes(res.status))
                throw new BlobsInternalError(res);
              if (res.status === 404)
                done = !0;
              else {
                let page = await res.json();
                page.next_cursor ? currentCursor = page.next_cursor : done = !0, blobs = (page.blobs ?? []).map(_Store.formatListResultBlob).filter(Boolean), directories = page.directories ?? [];
              }
              return {
                done: !1,
                value: {
                  blobs,
                  directories
                }
              };
            });
          }
        };
      }
    };
  }
}, getDeployStoreRegion = (clientOptions, context) => {
  if (clientOptions.region)
    return clientOptions.region;
  if (clientOptions.edgeURL || clientOptions.uncachedEdgeURL) {
    if (!context.primaryRegion)
      throw new Error(
        "When accessing a deploy store, the Netlify Blobs client needs to be configured with a region, and one was not found in the environment. To manually set the region, set the `region` property in the store options. If you are using the Netlify CLI, you may have an outdated version; run `npm install -g netlify-cli@latest` to update and try again."
      );
    return context.primaryRegion;
  }
  return REGION_AUTO;
};
var getStore = (input, options) => {
  if (typeof input == "string") {
    let contextOverride = options?.siteID && options?.token ? { siteID: options?.siteID, token: options?.token } : void 0, clientOptions = getClientOptions(options ?? {}, contextOverride), client = new Client(clientOptions);
    return new Store({ client, name: input });
  }
  if (typeof input?.name == "string") {
    let { name } = input, contextOverride = input?.siteID && input?.token ? { siteID: input?.siteID, token: input?.token } : void 0, clientOptions = getClientOptions(input, contextOverride);
    if (!name)
      throw new MissingBlobsEnvironmentError(["name"]);
    let client = new Client(clientOptions);
    return new Store({ client, name });
  }
  if (typeof input?.deployID == "string") {
    let context = getEnvironmentContext(), clientOptions = getClientOptions(input, context), { deployID } = input;
    if (!deployID)
      throw new MissingBlobsEnvironmentError(["deployID"]);
    clientOptions.region = getDeployStoreRegion(clientOptions, context);
    let client = new Client(clientOptions);
    return new Store({ client, deployID });
  }
  throw new Error(
    "The `getStore` method requires the name of the store as a string or as the `name` property of an options object"
  );
};
export {
  getStore
};
