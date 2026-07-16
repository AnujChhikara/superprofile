import { render } from "preact";
import { App } from "./App";

const params = new URLSearchParams(location.search);
const workspaceKey = params.get("ws") ?? "";

render(<App workspaceKey={workspaceKey} />, document.getElementById("app")!);
