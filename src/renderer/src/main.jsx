import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App.jsx";
import LocalPairing from './LocalPairing.jsx';
import PageErrorBoundary from './PageErrorBoundary.jsx';

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PageErrorBoundary><LocalPairing><App /></LocalPairing></PageErrorBoundary>
  </React.StrictMode>,
);
