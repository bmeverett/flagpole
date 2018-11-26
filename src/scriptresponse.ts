import { iResponse, GenericResponse, SimplifiedResponse, ResponseType } from "./response";
import { Scenario } from "./scenario";

export class ScriptResponse extends GenericResponse implements iResponse {

    constructor(scenario: Scenario, url: string, response: SimplifiedResponse) {
        super(scenario, url, response);
        this.status().between(200, 299);
        this.headers('Content-Type')
            .label('MIME Type matches expected value for JavaScript')
            .matches(/(text|application)\/(javascript|ecmascript)/);
    }

    public getType(): ResponseType {
        return ResponseType.script;
    }

}