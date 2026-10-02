import { Github } from "lucide-react";

/** Shared legal attribution for every authenticated section. */
export default function AppFooter() {
  return (
    <footer className="app-footer">
      <span>© {new Date().getFullYear()} Camilo Molina</span>
      <a href="https://github.com/CamiloTechCore" target="_blank" rel="noreferrer">
        <Github size={15} aria-hidden="true" />
        @CamiloTechCore
      </a>
    </footer>
  );
}
