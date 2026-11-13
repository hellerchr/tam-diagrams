import type { UmlError } from "../src/uml";

// Shared test fixtures for the diagram engine tests.
export const colors = {
  background: "#ffffff",
  surface: "#f0f0f2",
  text: "#1b1c1f",
  secondary: "#3f4146",
  edge: "#6b6d73",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  font: "system-ui",
  dark: false,
};

/** The plainer theme the UML tests render with. */
export const umlColors = {
  background: "#ffffff",
  text: "#1b1c1f",
  secondary: "#3f4146",
  series: [],
  font: "system-ui",
  dark: false,
};

/** The error `parse` throws for `source`; fails when it parses. */
export const parseError = (parse: (source: string) => unknown, source: string) => {
  try {
    parse(source);
  } catch (reason) {
    return reason as UmlError;
  }
  throw new Error("parsed");
};
