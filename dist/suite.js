"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
const scenario_1 = require("./scenario");
class Suite {
    constructor(title) {
        this.scenarios = [];
        this.baseUrl = null;
        this.waitToExecute = false;
        this.byTag = {};
        this.title = title;
        this.start = Date.now();
    }
    wait(bool = true) {
        this.waitToExecute = bool;
        return this;
    }
    isDone() {
        return this.scenarios.every(function (scenario) {
            return scenario.isDone();
        });
    }
    getDuration() {
        return Date.now() - this.start;
    }
    print() {
        index_1.Flagpole.heading(this.title);
        index_1.Flagpole.message('» Base URL: ' + this.baseUrl);
        index_1.Flagpole.message('» Environment: ' + process.env.FLAGPOLE_ENV);
        index_1.Flagpole.message('» Took ' + this.getDuration() + "ms\n");
        let color = this.passed() ? "\x1b[32m" : "\x1b[31m";
        index_1.Flagpole.message('» Passed? ' + (this.passed() ? 'Yes' : 'No') + "\n", color);
        this.scenarios.forEach(function (scenario) {
            scenario.getLog().forEach(function (line) {
                line.write();
            });
        });
        return this;
    }
    Scenario(title, tags) {
        let suite = this;
        let scenario = new scenario_1.Scenario(this, title, function () {
            if (suite.isDone()) {
                suite.print();
                process.exit(suite.passed() ? 0 : 1);
            }
        });
        if (this.waitToExecute) {
            scenario.wait();
        }
        if (typeof tags !== 'undefined') {
            tags.forEach(function (tag) {
                suite.byTag.hasOwnProperty(tag) ?
                    suite.byTag[tag].push(scenario) :
                    (suite.byTag[tag] = [scenario]);
            });
        }
        this.scenarios.push(scenario);
        return scenario;
    }
    getScenarioByTag(tag) {
        return this.byTag.hasOwnProperty(tag) ?
            this.byTag[tag][0] : null;
    }
    getAllScenariosByTag(tag) {
        return this.byTag.hasOwnProperty(tag) ?
            this.byTag[tag] : [];
    }
    base(url) {
        this.baseUrl = url;
        return this;
    }
    buildUrl(path) {
        return (!!this.baseUrl) ?
            (this.baseUrl + path) :
            path;
    }
    execute() {
        this.scenarios.forEach(function (scenario) {
            scenario.execute();
        });
        return this;
    }
    passed() {
        return this.scenarios.every(function (scenario) {
            return scenario.passed();
        });
    }
    failed() {
        return this.scenarios.some(function (scenario) {
            return scenario.failed();
        });
    }
}
exports.Suite = Suite;
