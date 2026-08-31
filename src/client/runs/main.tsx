import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "../shared/theme.css";
import "../editor/editor.css";
import "./runs.css";
import { RunsApp } from "./RunsApp";

const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light" || theme === "dark") {
	document.documentElement.dataset.theme = theme;
}

createRoot(document.getElementById("root")!).render(<RunsApp />);
