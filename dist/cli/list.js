"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cli_helper_1 = require("./cli-helper");
function list(suite = []) {
    cli_helper_1.Cli.hideBanner = true;
    if (cli_helper_1.Cli.commandArg == 'env') {
        cli_helper_1.printHeader();
        cli_helper_1.printSubheader('List Environments');
        cli_helper_1.Cli.log('');
        let envNames = cli_helper_1.Cli.config.getEnvironmentNames();
        if (envNames.length > 0) {
            cli_helper_1.Cli.log('Found these environments:');
            cli_helper_1.Cli.list(envNames);
            cli_helper_1.Cli.log("\n");
            cli_helper_1.Cli.exit(0);
        }
        else {
            cli_helper_1.Cli.log("Did not find any environments.\n");
            cli_helper_1.Cli.exit(2);
        }
    }
    else {
        cli_helper_1.printHeader();
        cli_helper_1.printSubheader('List Suites');
        cli_helper_1.Cli.log('Looking in folder: ' + cli_helper_1.Cli.config.getTestsFolder());
        cli_helper_1.Cli.log('');
        let suiteNames = cli_helper_1.Cli.config.getSuiteNames();
        if (suiteNames.length > 0) {
            cli_helper_1.Cli.log('Found these test suites:');
            cli_helper_1.Cli.list(suiteNames);
            cli_helper_1.Cli.log("\n");
            cli_helper_1.Cli.exit(0);
        }
        else {
            cli_helper_1.Cli.log("Did not find any test suites.\n");
            cli_helper_1.Cli.exit(2);
        }
    }
}
exports.list = list;