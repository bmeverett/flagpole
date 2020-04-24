#!/usr/bin/env node
"use strict";
import { Cli, parseConfigFile } from "./cli";
import { normalizePath, emptyFolder } from "../util";
import { FlagpoleExecution } from "../flagpoleexecutionoptions";

const path = require("path");

/**
 * COMMAND LINE ARGUMENTS
 */
let commands = [
  "run",
  "list",
  "init",
  "add",
  "rm",
  "import",
  "pack",
  "login",
  "logout",
  "deploy",
  "about",
  "serve",
  "watch",
  "build",
  "debug",
  "audit",
];
let yargs = require("yargs");
let argv = require("yargs")
  .usage("Usage: $0 <command> [options]")
  .help(false)
  .alias("v", "version")
  .version()
  .demandCommand(1, "You must specify a command: " + commands.join(", "))
  .alias({
    s: "suite",
    t: "tag",
    e: "env",
    c: "config",
    d: "debug",
    h: "hide_banner",
    o: "output",
    q: "quiet",
  })
  .describe({
    s: "Specify one or more suites to run",
    t: "Specify a tag for suites to run",
    e: "Environment like: dev, staging, prod",
    c: "Specify path to config file",
    d: "Show extra debug info",
    h: "Hide the output banner",
    o: "Output: console, text, html, json, csv, browser",
    q: "Quiet Mode: Silence all output",
  })
  .array("s")
  .string("t")
  .string("e")
  .boolean("a")
  .boolean("d")
  .boolean("h")
  .boolean("q")
  .string("o")
  .string("base")
  .boolean("all")
  .default("o", "console")
  .default("s", [])
  .default("t", "")
  .default("h", false)
  .default("q", false)
  .default("l", false)
  .example("flagpole list", "To show a list of test suites")
  .example("flagpole run --all", "To run all test suites")
  .example("flagpole run -s smoke", "To run just the suite called smoke")
  .example("flagpole run -s browser/*", "Or you can run all tests in a folder")
  .example("flagpole run -t basic", 'To run all suites with tag "basic"')
  .example("flagpole init", "Initialize a new Flagpole project")
  .example("flagpole add suite", "Add a new test suite")
  .example("flagpole add scenario", "Add a new scenario to a test suite")
  .example("flagpole rm suite", "Temove a suite")
  //.example("flagpole pack", "Pack this Flagpole project into a zip achive")
  .example(
    "flagpole build",
    "Transpile TypeScript source tests to JavaScript output"
  )
  .epilogue("For more information, go to https://github.com/flocasts/flagpole")
  .wrap(Math.min(100, yargs.terminalWidth()))
  .fail(function (msg, err, yargs) {
    Cli.log(yargs.help());
    Cli.log(msg);
    Cli.exit(1);
  }).argv;

// Enforce limited list of commands
Cli.command = argv._[0];
Cli.commandArg = argv._[1];
Cli.commandArg2 = argv._[2];
if (commands.indexOf(String(Cli.command)) < 0) {
  Cli.log("Command must be either: " + commands.join(", ") + "\n");
  Cli.log("Example: flagpole run\n");
  Cli.exit(1);
}

/**
 * Settings
 */
FlagpoleExecution.opts.setOutputFromString(argv.o);
FlagpoleExecution.opts.automaticallyPrintToConsole = true;
FlagpoleExecution.opts.automaticallyPrintToConsole = !argv.q;
FlagpoleExecution.opts.quietMode = !!argv.q;
FlagpoleExecution.opts.asyncExecution = !!argv.a;
Cli.hideBanner = !!argv.h || argv.q || argv.o !== "console";
Cli.projectPath = normalizePath(
  typeof argv.p !== "undefined" ? argv.p : process.cwd()
);

/**
 * Read the config file in the path
 */
Cli.configPath = argv.c || path.join(Cli.projectPath, "flagpole.json");
// If we found a config file at this path
parseConfigFile(Cli.configPath);
// If they specified a command line config that doesn't exist
if (argv.c && !Cli.config.isValid()) {
  Cli.log("The config file you specified did not exist.\n");
  Cli.exit(1);
}

// Set environment
FlagpoleExecution.opts.environment = (() => {
  // Use commandline if we got it
  if (argv.e) {
    return argv.e;
  }
  // Otherwise use the first env from config
  const envs = Object.keys(Cli.config.environments);
  if (envs.length > 0) {
    return envs[0];
  }
  // Lastly return dev as final fallback
  return "dev";
})();

// Settings from config file
FlagpoleExecution.opts.configPath = Cli.configPath;
FlagpoleExecution.opts.baseDomain = (() => {
  if (argv.base) {
    return argv.base;
  }
  if (Cli.config.environments[FlagpoleExecution.opts.environment]) {
    return Cli.config.environments[FlagpoleExecution.opts.environment]
      .defaultDomain;
  }
  return "";
})();

/**
 * Do stuff
 */
if (argv.d || Cli.command == "debug") {
  require("./debug").debug(argv);
}
if (Cli.command == "list") {
  require("./list").list();
} else if (Cli.command == "audit") {
  require("./audit").audit();
} else if (Cli.command == "run") {
  // Empty previous cache before running a new job
  const cacheFolder = Cli.config.getCacheFolder();
  emptyFolder(cacheFolder)
    .then(() => {
      require("./run").run(
        argv.s,
        argv.t,
        argv.all || Cli.commandArg === "all"
      );
    })
    .catch((err) => {
      console.log(err);
    });
} else if (Cli.command == "login") {
  require("./login").login();
} else if (Cli.command == "logout") {
  require("./logout").logout();
} else if (Cli.command == "init") {
  require("./init").init();
} else if (Cli.command == "pack") {
  require("./pack").pack();
} else if (Cli.command == "add") {
  require("./add").add();
} else if (Cli.command == "rm") {
  require("./rm").rm();
} else if (Cli.command == "deploy") {
  require("./deploy").deploy();
} else if (Cli.command == "about") {
  require("./about").about();
} else if (Cli.command == "import") {
  if (Cli.commandArg == "suite") {
    // move import suite here when we add ability to import something else
  }
  require("./import").importSuite();
} else if (Cli.command == "serve") {
  require("./serve").serve();
} else if (Cli.command == "watch") {
  require("./watch").watch(argv.s, argv.t);
} else if (Cli.command == "build") {
  require("./build").build();
}
