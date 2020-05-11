import { ResponseType, LineType, ScenarioStatusEvent } from "./enums";
import {
  iAssertion,
  iAssertionContext,
  iLogItem,
  iResponse,
  iScenario,
  iSuite,
  iNextCallback,
  KeyValue,
  ResponsePipe,
  ScenarioCallback,
  ScenarioStatusCallback,
  ScenarioCallbackAndMessage,
  ResponsePipeCallbackAndMessage,
} from "./interfaces";
import * as puppeteer from "puppeteer-core";
import { BrowserControl, iBrowserControlResponse } from "./browsercontrol";
import { createResponse } from "./responsefactory";
import {
  AssertionResult,
  AssertionPass,
  AssertionFail,
  AssertionFailWarning,
} from "./logging/assertionresult";
import { HttpResponse } from "./httpresponse";
import { ResourceResponse } from "./resourceresponse";
import { LogScenarioSubHeading, LogScenarioHeading } from "./logging/heading";
import { LogComment } from "./logging/comment";
import { LogCollection } from "./logging/logcollection";
import {
  HttpRequestOptions,
  HttpProxy,
  HttpAuth,
  HttpRequest,
  HttpTimeout,
  HttpMethodVerb,
  HttpMethodVerbAllowedValues,
  BrowserOptions,
} from "./httprequest";
import { FlagpoleExecution } from "./flagpoleexecution";
import { toType } from "./util";
import { AssertionContext } from "./assertioncontext";
import * as bluebird from "bluebird";

/**
 * A scenario contains tests that run against one request
 */
export class Scenario implements iScenario {
  public readonly suite: iSuite;

  public get responseType(): ResponseType {
    return this._responseType;
  }

  public get title(): string {
    return this._title;
  }

  public set title(newTitle: string) {
    if (this.hasExecuted) {
      throw "Can not change the scenario's title after execution has started.";
    }
    this._title = newTitle;
  }

  /**
   * Length of time in milliseconds from initialization to completion
   */
  public get totalDuration(): number {
    return this._timeScenarioFinished !== null
      ? this._timeScenarioFinished - this._timeScenarioInitialized
      : Date.now() - this._timeScenarioInitialized;
  }

  /**
   * Length of time in milliseconds from start of execution to completion
   */
  public get executionDuration(): number | null {
    return this._timeScenarioFinished !== null &&
      this._timeScenarioExecuted !== null
      ? this._timeScenarioFinished - this._timeScenarioExecuted
      : null;
  }

  /**
   * Length of time in milliseconds from request start to response complete
   */
  public get requestDuration(): number | null {
    return this._timeRequestStarted !== null && this._timeRequestLoaded !== null
      ? this._timeRequestLoaded - this._timeRequestStarted
      : null;
  }

  /**
   * Did any assertions in this scenario fail?
   */
  public get hasFailed(): boolean {
    return this._log.items.some((item: iLogItem) => {
      return item.type == "resultFailure";
    });
  }

  /**
   * Did all assertions in this scenario pass? This also requires that the scenario has completed
   */
  public get hasPassed(): boolean {
    return this.hasFinished && !this.hasFailed;
  }

  /**
   * We ready to pull the trigger on this one?
   */
  public get isReadyToExecute(): boolean {
    return (
      !this.hasExecuted &&
      !this.isImplicitWait &&
      !this.isExplicitWait &&
      this.hasNextCallbacks
    );
  }

  /**
   * Has this scenario already been executed?
   */
  public get hasExecuted(): boolean {
    return this._timeScenarioExecuted !== null;
  }

  /**
   * Did this scenario finish executing?
   */
  public get hasFinished(): boolean {
    return this.hasExecuted && this._timeScenarioFinished !== null;
  }

  /**
   * Get the url
   */
  public get url(): string | null {
    return this._request.uri;
  }

  public set url(value: string | null) {
    if (this.hasRequestStarted) {
      throw "Can not change the URL after the request has already started.";
    }
    if (value !== null) {
      // If the HTTP method was part of open
      const match = /([A-Z]+) (.*)/.exec(value);
      if (match !== null) {
        const verb: string = match[1].toLowerCase();
        if (HttpMethodVerbAllowedValues.includes(verb)) {
          this.setMethod(<HttpMethodVerb>verb);
        }
        value = match[2];
      }
      // If the URL had parameters in it, implicitly wait for execute parameters
      if (/{[A-Za-z0-9_ -]+}/.test(value)) {
        this.wait();
      }
    }
    this._request.uri = value;
  }

  /**
   * URL after redirects
   */
  public get finalUrl(): string | null {
    return this._finalUrl;
  }

  /**
   * Count the redirects
   */
  public get redirectCount(): number {
    return this._redirectChain.length;
  }

  /**
   * Return every URL reidrect
   */
  public get redirectChain(): string[] {
    return this._redirectChain;
  }

  /**
   * Retrieve the options that itialized the request in this scenario
   */
  public get request(): HttpRequest {
    return this._request;
  }

  /**
   * We will implicitly wait if the URL is not defined or has params in it
   */
  private get isImplicitWait(): boolean {
    return this.url === null || /{[A-Za-z0-9_ -]+}/.test(this.url);
  }

  private get isExplicitWait(): boolean {
    return this._waitToExecute;
  }

  private get hasNextCallbacks(): boolean {
    return this._nextCallbacks.length > 0;
  }

  private get hasRequestStarted(): boolean {
    return this._timeRequestStarted !== null;
  }

  protected _title: string;
  protected _log: LogCollection = new LogCollection();
  protected _subscribers: ScenarioStatusCallback[] = [];
  protected _nextCallbacks: iNextCallback[] = [];
  protected _nextMessages: Array<string | null> = [];
  protected _beforeCallbacks: ScenarioCallbackAndMessage[] = [];
  protected _afterCallbacks: ScenarioCallbackAndMessage[] = [];
  protected _finallyCallbacks: ScenarioCallbackAndMessage[] = [];
  protected _failureCallbacks: ScenarioCallbackAndMessage[] = [];
  protected _successCallbacks: ScenarioCallbackAndMessage[] = [];
  protected _pipeCallbacks: ResponsePipeCallbackAndMessage[] = [];
  protected _timeScenarioInitialized: number = Date.now();
  protected _timeScenarioExecuted: number | null = null;
  protected _timeRequestStarted: number | null = null;
  protected _timeRequestLoaded: number | null = null;
  protected _timeScenarioFinished: number | null = null;
  protected _responseType: ResponseType = "html";
  protected _redirectChain: string[] = [];
  protected _finalUrl: string | null = null;
  protected _waitToExecute: boolean = false;
  protected _waitTime: number = 0;
  protected _flipAssertion: boolean = false;
  protected _ignoreAssertion: boolean = false;
  protected _request: HttpRequest;
  protected _browserControl: BrowserControl | null = null;
  protected _isMock: boolean = false;
  protected _response: iResponse;
  protected _defaultBrowserOptions: BrowserOptions = {
    headless: true,
    recordConsole: true,
    outputConsole: false,
  };
  protected _defaultRequestOptions: HttpRequestOptions = {
    method: "get",
  };
  protected _aliasedData: any = {};
  protected _requestPromise: Promise<void>;
  protected _requestResolve: Function = () => {};
  protected _finishedPromise: Promise<void>;
  protected _finishedResolve: Function = () => {};

  public static create(
    suite: iSuite,
    title: string,
    type: ResponseType,
    opts: any
  ): iScenario {
    return new Scenario(suite, title).setResponseType(type, opts);
  }

  protected constructor(suite: iSuite, title: string) {
    this.suite = suite;
    this._request = new HttpRequest(this._defaultRequestOptions);
    this._title = title;
    this._response = new ResourceResponse(this);
    this._requestPromise = new Promise((resolve) => {
      this._requestResolve = resolve;
    });
    this._finishedPromise = new Promise((resolve) => {
      this._finishedResolve = resolve;
    });
  }

  public set(aliasName: string, value: any): iScenario {
    this._aliasedData[aliasName] = value;
    return this;
  }

  public get(aliasName: string): any {
    return this._aliasedData[aliasName];
  }

  /**
   * Get log of all assetions, comments, etc. from this scenario
   */
  public async getLog(): Promise<iLogItem[]> {
    return this._log.items;
  }

  /**
   * PubSub Subscription to any significant status changes of this scenario
   *
   * @param callback
   */
  public subscribe(callback: ScenarioStatusCallback): iScenario {
    this._subscribers.push(callback);
    return this;
  }

  /**
   * Set body to submit as JSON object
   *
   * @param jsonObject
   */
  public setJsonBody(json: KeyValue): iScenario {
    this.request.setJsonData(json);
    return this;
  }

  /**
   * Set body to submit as raw string
   */
  public setRawBody(str: string): iScenario {
    this._request.data = str;
    return this;
  }

  /**
   * Make sure the web page has valid SSL certificate
   */
  public verifyCert(verify: boolean): iScenario {
    this._request.verifyCert = verify;
    return this;
  }

  public setProxy(proxy: HttpProxy): iScenario {
    this._request.proxy = proxy;
    return this;
  }

  /**
   * Set the timeout for how long the request should wait for a response
   */
  public setTimeout(n: number): iScenario;
  public setTimeout(timeouts: HttpTimeout): iScenario;
  public setTimeout(timeout: HttpTimeout | number): iScenario {
    this._request.timeout =
      typeof timeout === "number"
        ? {
            open: timeout,
          }
        : timeout;
    return this;
  }

  /**
   * Set the form options that will be submitted with the request
   *
   * @param form
   */
  public setFormData(form: FormData): iScenario;
  public setFormData(form: KeyValue, isMultipart?: boolean): iScenario;
  public setFormData(
    form: KeyValue | FormData,
    isMultipart?: boolean
  ): iScenario {
    this._request.setFormData(form, isMultipart);
    return this;
  }

  /**
   * Maximum number of redirects to allow
   *
   * @param n
   */
  public setMaxRedirects(n: number): iScenario {
    this._request.maxRedirects = n;
    return this;
  }

  /**
   * Set the basic authentication headers to be sent with this request
   *
   * @param authorization
   */
  public setBasicAuth(auth: HttpAuth): iScenario {
    this._request.auth = auth;
    this._request.authType = "basic";
    return this;
  }

  /**
   * Set the digest authentication headers to be sent with this request
   *
   * @param authorization
   */
  public setDigestAuth(auth: HttpAuth): iScenario {
    this._request.auth = auth;
    this._request.authType = "digest";
    return this;
  }

  /**
   * Set the authorization header with a bearer token
   *
   * @param {string} token
   */
  public setBearerToken(token: string): iScenario {
    this.setHeader("Authorization", `Bearer ${token}`);
    return this;
  }

  /**
   * Set a cookie
   *
   * @param key
   * @param value
   * @param opts
   */
  public setCookie(key: string, value: string): iScenario {
    this._request.setCookie(key, value);
    return this;
  }

  /**
   * Set the full list of headers to submit with this request
   *
   * @param headers
   */
  public setHeaders(headers: KeyValue): iScenario {
    this._request.headers = { ...this._request.headers, ...headers };
    return this;
  }

  /**
   * Set a single header key-value without overriding others
   *
   * @param {string} key
   * @param value
   */
  public setHeader(key: string, value: any): iScenario {
    this._request.setHeader(key, value);
    return this;
  }

  /**
   * Set the HTTP method of this request
   *
   * @param {string} method
   */
  public setMethod(method: HttpMethodVerb): iScenario {
    this._request.method = method;
    return this;
  }

  /**
   * Do not run this scenario until execute() is called
   *
   * @param bool
   */
  public wait(bool: boolean = true): iScenario {
    // Was waiting but not anymore
    if (this._waitToExecute && !bool) {
      this._waitTime = Date.now() - this._timeScenarioInitialized;
    }
    // Set waiting value
    this._waitToExecute = bool;
    return this;
  }

  public waitFor(thatScenario: iScenario): iScenario {
    if (this === thatScenario) {
      throw new Error("Scenario can't wait for itself");
    }
    this.wait();
    thatScenario.success(async () => {
      this.wait(false);
    });
    return this;
  }

  /**
   * Add a neutral line to the output
   */
  public comment(input: any): iScenario {
    const type = toType(input);
    const message: string =
      type === "string"
        ? input
        : input.isFlagpoleValue
        ? input.toString()
        : JSON.stringify(input, null, 2);
    return this._pushToLog(new LogComment(message));
  }

  /**
   * Push in a new passing assertion
   */
  public result(result: AssertionResult): iScenario {
    return this._pushToLog(result);
  }

  /**
   * Ignore assertions until further notice. This is created to prevent automatic assertions from firing.
   */
  public ignore(assertions: boolean | Function = true): iScenario {
    if (typeof assertions == "boolean") {
      this._ignoreAssertion = assertions;
    } else if (typeof assertions == "function") {
      this.ignore(true);
      assertions();
      this.ignore(false);
    }
    return this;
  }

  /**
   * Insert a next call back that waits this amount of time before continuing
   *
   * @param milliseconds
   */
  public pause(milliseconds: number): iScenario {
    this.next((context) => {
      context.comment(`Pause for ${milliseconds}ms`);
      return context.pause(milliseconds);
    });
    return this;
  }

  /**
   * Set the URL that this scenario will hit
   *
   * @param {string} url
   */
  public open(url: string, opts?: HttpRequestOptions): iScenario {
    if (this.hasExecuted) {
      throw `Can call open after scenario has executed`;
    }
    // Merge in options
    if (opts) {
      this._request.setOptions(opts);
    }
    // Okay now set the open method
    this.url = String(url);
    this._isMock = false;
    return this;
  }

  /**
   * Set the callback for the assertions to run after the request has a response
   */
  public next(message: string, callback: iNextCallback): iScenario;
  public next(callback: iNextCallback): iScenario;
  public next(...callbacks: iNextCallback[]): iScenario;
  public next(
    a: iNextCallback | iNextCallback[] | string,
    b?: iNextCallback
  ): iScenario {
    if (Array.isArray(a)) {
      a.forEach((callback) => {
        this._next(callback, null, true);
      });
    } else {
      this._next(a, b, true);
    }
    return this;
  }

  /**
   * Insert this as the first next
   */
  public nextPrepend(message: string, callback: iNextCallback): iScenario;
  public nextPrepend(callback: iNextCallback): iScenario;
  public nextPrepend(a: iNextCallback | string, b?: iNextCallback): iScenario {
    return this._next(a, b, false);
  }

  /**
   * Skip this scenario completely and mark it done
   */
  public async skip(message?: string): Promise<iScenario> {
    if (this.hasExecuted) {
      throw `Can't skip Scenario since it already started executing.`;
    }
    this._markExecutionAsStarted();
    await this._fireBefore();
    this._publish(ScenarioStatusEvent.executionSkipped);
    this.comment(`Skipped${message ? ": " + message : ""}`);
    this._publish(ScenarioStatusEvent.executionProgress);
    await this._fireAfter();
    await this._fireFinally();
    return this;
  }

  public async cancel(): Promise<iScenario> {
    if (this.hasExecuted) {
      throw new Error(
        `Can't cancel Scenario since it already started executing.`
      );
    }
    this._markExecutionAsStarted();
    await this._fireBefore();
    await this._fireAfter();
    await this._fireFinally();
    return this;
  }

  /**
   * Get the browser object for a browser request
   */
  public getBrowserControl(): BrowserControl {
    this._browserControl =
      this._browserControl !== null
        ? this._browserControl
        : new BrowserControl();
    return this._browserControl;
  }

  /**
   * Execute this scenario
   */
  public async execute(): Promise<iScenario>;
  public async execute(params: {
    [key: string]: string | number;
  }): Promise<iScenario>;
  public async execute(pathParams?: {
    [key: string]: string | number;
  }): Promise<iScenario> {
    if (this.hasExecuted) {
      throw "Scenario has already started executing. Can not call execute again.";
    }
    // Apply path parameters when the url was like /articles/{id}
    if (pathParams) {
      Object.keys(pathParams).forEach((key) => {
        this.url =
          this.url?.replace(`{${key}}`, String(pathParams[key])) || null;
      });
    }
    // Execute was called, so stop any explicit wait
    this.wait(false);
    // We ready to go?
    if (this.isReadyToExecute) {
      this._markExecutionAsStarted();
      // Do before callbacks
      await this._fireBefore();
      // Log the start of this scenario
      this._pushToLog(new LogScenarioHeading(this.title));
      // If we waited first
      if (this._waitTime > 0) {
        this.comment(`Waited ${this._waitTime}ms`);
      }
      // Execute it
      this._publish(ScenarioStatusEvent.executionStart);
      this._isMock ? this._executeMock() : this._executeRequest();
      this._publish(ScenarioStatusEvent.executionProgress);
    }
    return this;
  }

  /**
   * Callback after scenario completes if successful
   *
   * @param callback
   */
  public success(callback: ScenarioCallback): iScenario;
  public success(message: string, callback: ScenarioCallback): iScenario;
  public success(...callbacks: ScenarioCallback[]): iScenario;
  public success(
    a: string | ScenarioCallback | ScenarioCallback[],
    b?: ScenarioCallback
  ): iScenario {
    return this._pushCallbacks("success", "_successCallbacks", a, b);
  }

  /**
   * Callback after scenario completes if failed
   *
   * @param callback
   */
  public failure(callback: ScenarioCallback): iScenario;
  public failure(message: string, callback: ScenarioCallback): iScenario;
  public failure(...callbacks: ScenarioCallback[]): iScenario;
  public failure(
    a: string | ScenarioCallback | ScenarioCallback[],
    b?: ScenarioCallback
  ): iScenario {
    return this._pushCallbacks("failure", "_failureCallbacks", a, b);
  }

  /**
   * Alter the response before we process assertions
   *
   * @param callback
   */
  public pipe(callback: ResponsePipe): iScenario;
  public pipe(...callbacks: ResponsePipe[]): iScenario;
  public pipe(message: string, callback: ResponsePipe): iScenario;
  public pipe(
    a: string | ResponsePipe | ResponsePipe[],
    b?: ResponsePipe
  ): iScenario {
    return this._pushCallbacks("pipe", "_pipeCallbacks", a, b);
  }

  /**
   * callback just before the scenario starts to execute
   *
   * @param callback
   */
  public before(callback: ScenarioCallback): iScenario;
  public before(...callbacks: ScenarioCallback[]): iScenario;
  public before(message: string, callback: ScenarioCallback): iScenario;
  public before(
    a: string | ScenarioCallback | ScenarioCallback[],
    b?: ScenarioCallback
  ): iScenario {
    return this._pushCallbacks("before", "_beforeCallbacks", a, b);
  }

  /**
   * callback just after the scenario completes
   */
  public after(callback: ScenarioCallback): iScenario;
  public after(...callbacks: ScenarioCallback[]): iScenario;
  public after(message: string, callback: ScenarioCallback): iScenario;
  public after(
    a: string | ScenarioCallback | ScenarioCallback[],
    b?: ScenarioCallback
  ): iScenario {
    return this._pushCallbacks("after", "_afterCallbacks", a, b);
  }

  /**
   * callback at the very end, whether pass or fail
   *
   * @param callback
   */
  public finally(callback: ScenarioCallback): iScenario;
  public finally(...callbacks: ScenarioCallback[]): iScenario;
  public finally(message: string, callback: ScenarioCallback): iScenario;
  public finally(
    a: string | ScenarioCallback | ScenarioCallback[],
    b?: ScenarioCallback
  ): iScenario {
    return this._pushCallbacks("finally", "_finallyCallbacks", a, b);
  }

  /**
   * Fake response from local file for testing
   */
  public mock(localPath: string): iScenario {
    this.url = localPath;
    this._isMock = true;
    return this;
  }

  /**
   * Set the type of response this scenario is and the options
   *
   * @param type
   * @param opts
   */
  public setResponseType(type: ResponseType, opts: any = {}): iScenario {
    if (this.hasExecuted) {
      throw "Scenario was already executed. Can not change type.";
    }
    // Merge passed in opts with default opts
    this._responseType = type;
    if (["browser", "extjs"].includes(type)) {
      // Overrides from command line
      const overrides: any = {};
      if (FlagpoleExecution.global.headless !== undefined) {
        overrides.headless = FlagpoleExecution.global.headless;
      }
      // Set browser options
      this._request.setOptions({
        browserOptions: {
          ...this._defaultBrowserOptions, // Flagpole defaults
          ...opts, // What was in the code
          ...overrides, // What was in the command line
        },
      });
    } else {
      this._request
        .setOptions({
          ...this._defaultRequestOptions,
          ...opts,
        })
        .setOptions({
          type:
            this._responseType === "json"
              ? "json"
              : this._responseType === "image"
              ? "image"
              : "generic",
        });
    }
    this._response = createResponse(this);
    return this;
  }

  public waitForFinished(): Promise<void> {
    return this._finishedPromise;
  }

  public waitForResponse(): Promise<void> {
    return this._requestPromise;
  }

  public promise(): Promise<iScenario> {
    return new Promise((resolve, reject) => {
      this.success(resolve);
      this.failure(reject);
    });
  }

  public buildUrl(): URL {
    const path = this.url || "/";
    // If there was no base URL, skip this
    if (this.suite.baseUrl === null) {
      return new URL(path);
    }
    // If it is already an absolute URL, don't apply the base
    else if (/^https?:\/\//.test(path) || /^data:/.test(path)) {
      return new URL(path);
    }
    // If the path starts in // then it has domain, just inherit the protocol from the base
    else if (/^\/\//.test(path)) {
      return new URL(`${this.suite.baseUrl.protocol}//${path}`);
    }
    // if it starts with / then it's absolute
    else if (/^\//.test(path)) {
      return new URL(
        `${this.suite.baseUrl.protocol}//${this.suite.baseUrl.host}${path}`
      );
    }
    return new URL(path, this.suite.baseUrl.href);
  }

  private _pushCallbacks(
    name: string,
    callbacksName: string,
    a:
      | string
      | ScenarioCallback
      | ScenarioCallback[]
      | ResponsePipe
      | ResponsePipe[],
    b?: ScenarioCallback | ResponsePipe
  ): iScenario {
    if (this.hasFinished) {
      throw `Can not add ${name} callbacks after execution has finished.`;
    }
    if (Array.isArray(a)) {
      a.forEach((callback: any) => {
        this[callbacksName].push({
          message: "",
          callback: callback,
        });
      });
    } else {
      const { message, callback } = this._getOverloads(a, b);
      this[callbacksName].push({
        callback: callback,
        message: message,
      });
    }
    return this;
  }

  /**
   * Clear out any previous settings
   */
  protected _reset(): iScenario {
    this._flipAssertion = false;
    return this;
  }

  /**
   * Send responses through the pipeline before we make assertions
   *
   * @param httpResponse
   */
  protected async _pipeResponses(
    httpResponse: HttpResponse
  ): Promise<HttpResponse> {
    await bluebird.mapSeries(this._pipeCallbacks, async (cb) => {
      cb.message && this.comment(cb.message);
      const result = await cb.callback(httpResponse);
      if (result) {
        httpResponse = result;
      }
    });
    return httpResponse;
  }

  /**
   * Handle the normalized response once the request comes back
   * This will loop through each next
   */
  protected async _processResponse(httpResponse: HttpResponse) {
    httpResponse = await this._pipeResponses(httpResponse);
    this._response.init(httpResponse);
    this._timeRequestLoaded = Date.now();
    this._requestResolve();
    this.result(
      new AssertionPass(
        "Loaded " + this._response.responseTypeName + " " + this.url
      )
    );
    let lastReturnValue: any = null;
    // Execute all the assertion callbacks one by one
    this._publish(ScenarioStatusEvent.executionProgress);
    Promise.mapSeries(this._nextCallbacks, (_then, index) => {
      const context: iAssertionContext = new AssertionContext(
        this,
        this._response
      );
      const comment: string | null = this._nextMessages[index];
      if (comment !== null) {
        this._pushToLog(new LogScenarioSubHeading(comment));
      }
      context.result = lastReturnValue;
      // Run this next
      lastReturnValue = _then.apply(context, [context]);
      // Warn about any incomplete assertions
      context.incompleteAssertions.forEach((assertion: iAssertion) => {
        this.result(
          new AssertionFailWarning(
            `Incomplete assertion: ${assertion.name}`,
            assertion
          )
        );
      });
      // Don't continue until last value and all assertions resolve
      return Promise.all([
        lastReturnValue,
        context.assertionsResolved,
        context.subScenariosResolved,
      ]).timeout(30000);
    })
      .then(() => {
        this._markScenarioCompleted();
      })
      .catch((err) => {
        this._markScenarioCompleted(err);
      });
    this._publish(ScenarioStatusEvent.executionProgress);
  }

  /**
   * Start a browser scenario
   */
  private _executeBrowserRequest() {
    const browserControl: BrowserControl = this.getBrowserControl();
    browserControl
      .open(this._request)
      .then((next: iBrowserControlResponse) => {
        const puppeteerResponse: puppeteer.Response = next.response;
        if (puppeteerResponse !== null) {
          this._finalUrl = puppeteerResponse.url();
          // Loop through the redirects to populate our array
          puppeteerResponse
            .request()
            .redirectChain()
            .forEach((req) => {
              this._redirectChain.push(req.url());
            });
          // Finishing processing the response
          this._processResponse(
            HttpResponse.fromPuppeteer(
              puppeteerResponse,
              next.body,
              next.cookies
            )
          );
        } else {
          this._markScenarioCompleted(`Failed to load ${this._request.uri}`);
        }
        return;
      })
      .catch((err) =>
        this._markScenarioCompleted(`Failed to load ${this._request.uri}`, err)
      );
  }

  /**
   * Start a regular request scenario
   */
  private _executeDefaultRequest() {
    this._request
      .fetch({
        redirect: (url: string) => {
          this._finalUrl = url;
          this._redirectChain.push(url);
        },
      })
      .then((response) => {
        this._processResponse(response);
      })
      .catch((err) => {
        this._markScenarioCompleted(`Failed to load ${this._request.uri}`, err);
      });
  }

  private _markRequestAsStarted() {
    this._timeRequestStarted = Date.now();
  }

  /**
   * Used by all request types to kick off the request
   */
  protected _executeRequest() {
    if (this.url === null) {
      throw "Can not execute request with null URL.";
    }
    if (this.hasRequestStarted) {
      throw "Request has already started.";
    }
    this.url = this.buildUrl().href;
    this._markRequestAsStarted();
    this._finalUrl = this._request.uri;
    if (["extjs", "browser"].includes(this._responseType)) {
      this._executeBrowserRequest();
    } else {
      this._executeDefaultRequest();
    }
  }

  /**
   * Start a mock scenario, which will load a local file
   */
  protected _executeMock() {
    if (this.url === null) {
      throw "Can not execute request with null URL.";
    }
    if (this.hasRequestStarted) {
      throw "Request has already started.";
    }
    this._markRequestAsStarted();
    const scenario: Scenario = this;
    HttpResponse.fromLocalFile(this.url)
      .then((mock: HttpResponse) => {
        scenario._processResponse(mock);
      })
      .catch((err) => {
        scenario._markScenarioCompleted(
          `Failed to load page ${scenario.url}`,
          err
        );
      });
  }

  /**
   * Mark this scenario as completed
   *
   * @returns {Scenario}
   */
  protected async _markScenarioCompleted(
    errorMessage: string | null = null,
    errorDetails?: string
  ): Promise<iScenario> {
    // Only run this once
    if (!this.hasFinished) {
      await this._fireAfter();
      this.comment(`Took ${this.executionDuration}ms`);
      // Scenario completed without an error (could be pass or fail)
      if (errorMessage === null) {
        this.hasPassed ? await this._fireSuccess() : await this._fireFailure();
      }
      // Scenario compelted with an error
      else {
        this.result(new AssertionFail(errorMessage, errorDetails));
        await this._fireFailure(errorDetails || errorMessage);
      }
      // Finally
      await this._fireFinally();
      // Close the browser window
      if (this._browserControl !== null) {
        //this._browserControl.close();
      }
    }
    return this;
  }

  private async _fireCallbacks(callbacks: ScenarioCallbackAndMessage[]) {
    await bluebird.mapSeries(callbacks, (cb) => {
      cb.message && this._pushToLog(new LogComment(cb.message));
      return cb.callback(this, this.suite);
    });
  }

  private _markExecutionAsStarted() {
    this._timeScenarioExecuted = Date.now();
  }

  /**
   * Run the before execution and wait for any response.
   */
  protected async _fireBefore(): Promise<any> {
    await this._fireCallbacks(this._beforeCallbacks);
    this._publish(ScenarioStatusEvent.beforeExecute);
  }

  /**
   * Run after execution and wait for any response
   */
  protected async _fireAfter(): Promise<void> {
    this._timeScenarioFinished = Date.now();
    await this._fireCallbacks(this._afterCallbacks);
    this._publish(ScenarioStatusEvent.afterExecute);
  }

  protected async _fireSuccess(): Promise<void> {
    await this._fireCallbacks(this._successCallbacks);
    this._publish(ScenarioStatusEvent.finished);
  }

  protected async _fireFailure(errorMessage?: string): Promise<void> {
    await this._fireCallbacks(this._failureCallbacks);
    errorMessage && this._pushToLog(new LogComment(errorMessage));
    this._publish(ScenarioStatusEvent.finished);
  }

  protected async _fireFinally(): Promise<void> {
    await this._fireCallbacks(this._finallyCallbacks);
    this._publish(ScenarioStatusEvent.finished);
    this._finishedResolve();
  }

  protected _getOverloads(
    a: any,
    b?: any
  ): { message: string | null; callback: Function } {
    return {
      message: this._getMessageOverload(a),
      callback: this._getCallbackOverload(a, b),
    };
  }

  protected _getCallbackOverload(a: any, b?: any): Function {
    return (() => {
      if (typeof b == "function") {
        return b;
      } else if (typeof a == "function") {
        return a;
      } else {
        throw new Error("No callback provided.");
      }
    })();
  }

  protected _getMessageOverload(a: any): string | null {
    return (() => {
      if (typeof a == "string" && a.trim().length > 0) {
        return a;
      }
      return null;
    })();
  }

  protected _next(
    a: iNextCallback | string,
    b?: iNextCallback | null,
    append: boolean = true
  ): iScenario {
    const callback: iNextCallback = <iNextCallback>(
      this._getCallbackOverload(a, b)
    );
    const message: string | null = this._getMessageOverload(a);
    // If it hasn't already finished
    if (!this.hasFinished) {
      if (append) {
        this._nextCallbacks.push(callback);
        this._nextMessages.push(message);
      } else {
        this._nextCallbacks.unshift(callback);
        this._nextMessages.unshift(message);
      }
    } else {
      throw "Scenario already finished.";
    }
    return this;
  }

  /**
   * PubSub Publish: To any subscribers, just listening for updates (no interupt)
   *
   * @param statusEvent
   */
  protected async _publish(statusEvent: ScenarioStatusEvent) {
    const scenario = this;
    this._subscribers.forEach(async (callback) => {
      callback(scenario, statusEvent);
    });
  }

  protected _pushToLog(logItem: iLogItem): iScenario {
    this._log.add(logItem);
    return this;
  }
}
