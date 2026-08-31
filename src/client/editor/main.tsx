import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "../shared/theme.css";
import { EditorApp } from "./EditorApp";
import "./editor.css";

createRoot(document.getElementById("root")!).render(<EditorApp />);
