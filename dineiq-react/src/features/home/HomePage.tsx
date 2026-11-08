import { useEffect, useLayoutEffect, useRef } from "react";
import { Link } from "react-router";
import { Logo } from "@/components/Logo";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  Clock3,
  MoveUpRight,
  ScanLine,
} from "lucide-react";
import { FloorPlan } from "./FloorPlan";
import { examples } from "./examples";
import { ProductScene } from "./ProductScene";
import { createHomepageMotion } from "./motion";
import "./home.css";

function Brand() {
  return (
    <Link to="/" className="home-brand" aria-label="DineIQ home">
      <Logo />
    </Link>
  );
}

function DashboardLink({ light = false }: { light?: boolean }) {
  return (
    <Link
      to="/login"
      className={`home-button${light ? " home-button--light" : ""}`}
    >
      Open dashboard{" "}
      <ArrowUpRight size={17} strokeWidth={1.6} aria-hidden="true" />
    </Link>
  );
}

function HeroArtifacts() {
  return (
    <div
      className="home-artifacts"
      aria-label="Illustrative DineIQ product details"
    >
      <div className="home-artifact home-artifact--floor">
        <div className="home-artifact-heading">
          <span>Dining room</span>
          <ScanLine size={14} aria-hidden="true" />
        </div>
        <FloorPlan tables={examples[0].tables} compact />
        <div className="home-artifact-footer">
          <span className="home-small-dot" /> A place for everyone.
        </div>
      </div>
      <div className="home-artifact home-artifact--occupancy">
        <span className="home-card-label">A room at a glance</span>
        <div className="home-occupancy-figure">
          <strong>
            4<span>/ 6</span>
          </strong>
          <svg
            viewBox="0 0 56 56"
            className="home-occupancy-ring"
            aria-label="Four of six tables occupied"
            role="img"
          >
            <circle
              cx="28"
              cy="28"
              r="23"
              fill="none"
              stroke="#eeedef"
              strokeWidth="5"
            />
            <circle
              cx="28"
              cy="28"
              r="23"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              strokeDasharray="96.34 144.51"
              strokeLinecap="round"
              transform="rotate(-90 28 28)"
            />
          </svg>
        </div>
        <span className="home-card-label">tables occupied</span>
        <div className="home-artifact-footer">Room for a little more.</div>
      </div>
      <div className="home-artifact home-artifact--timer">
        <div className="home-artifact-heading">
          <span>Table 04</span>
          <Clock3 size={14} aria-hidden="true" />
        </div>
        <strong className="home-timer">
          06<span>:</span>12
        </strong>
        <span className="home-card-label">A moment for some attention.</span>
        <div className="home-timer-track" aria-hidden="true">
          <span />
        </div>
      </div>
      <div className="home-artifact home-artifact--notification">
        <span className="home-notice-icon">
          <Bell size={18} strokeWidth={1.5} aria-hidden="true" />
        </span>
        <div>
          <span className="home-card-label">A gentle nudge</span>
          <strong>
            Good service starts
            <br />
            with noticing.
          </strong>
          <span className="home-notification-bottom">
            Table 04 · Service reminder{" "}
            <ArrowUpRight size={13} aria-hidden="true" />
          </span>
        </div>
      </div>
      <span className="home-hero-data-note">Illustrative product data</span>
    </div>
  );
}

const steps = [
  {
    number: "01",
    title: "One camera. A new perspective.",
    body: "Position a fixed camera with a clear view of your dining area. Start with the room you already have.",
    visual: "camera",
  },
  {
    number: "02",
    title: "Make it your dining room.",
    body: "Review the suggested tables and seats. Adjust the layout, give each table a name, and make it yours.",
    visual: "tables",
  },
  {
    number: "03",
    title: "Let your team take it from here.",
    body: "Follow table status, notice service needs, and confirm service and cleaning from your dashboard.",
    visual: "team",
  },
] as const;

function Workflow() {
  return (
    <section
      id="how-it-works"
      className="home-workflow home-section"
      aria-labelledby="home-workflow-title"
    >
      <div className="home-container">
        <div className="home-workflow-heading">
          <div>
            <span className="home-eyebrow">Thoughtfully simple</span>
            <h2 id="home-workflow-title">
              Your room.
              <br />
              <em>A little more in tune.</em>
            </h2>
          </div>
          <p>
            A fixed camera. A shared view.
            <br />A few less things to keep in your head.
          </p>
        </div>
        <div className="home-steps">
          {steps.map((step) => (
            <article className="home-step" key={step.number}>
              <div
                className={`home-step-visual home-step-visual--${step.visual}`}
                aria-hidden="true"
              >
                {step.visual === "camera" ? (
                  <>
                    <div className="home-camera-view">
                      <ScanLine size={36} strokeWidth={1} />
                      <span>Dining room camera</span>
                      <div className="home-view-corner" />
                    </div>
                    <span className="home-step-chip">
                      <span className="home-small-dot" /> One fixed view
                    </span>
                  </>
                ) : step.visual === "tables" ? (
                  <>
                    <div className="home-mini-layout">
                      <span>01</span>
                      <span>02</span>
                      <span>03</span>
                      <span>04</span>
                    </div>
                    <span className="home-step-chip">
                      <Check size={13} /> Layout reviewed
                    </span>
                    <MoveUpRight
                      className="home-layout-cursor"
                      size={23}
                      fill="currentColor"
                    />
                  </>
                ) : (
                  <>
                    <div className="home-confirmation">
                      <span className="home-confirmation-check">
                        <Check size={16} />
                      </span>
                      <div>
                        <strong>Table 04</strong>
                        <span>Service confirmed</span>
                      </div>
                      <span className="home-confirmation-time">Just now</span>
                    </div>
                    <span className="home-step-chip">
                      A little teamwork goes a long way.
                    </span>
                  </>
                )}
              </div>
              <span className="home-step-number">{step.number} /</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.title = "DineIQ — A calmer dining room";
  }, []);
  useLayoutEffect(() => {
    if (page.current) return createHomepageMotion(page.current);
  }, []);

  return (
    <div className="home-page" ref={page}>
      <a className="home-skip" href="#home-main">
        Skip to content
      </a>
      <header className="home-header home-container">
        <Brand />
        <nav className="home-nav" aria-label="Main navigation">
          <a href="#product">Product</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <Link to="/login" className="home-nav-signin">
          Sign in <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </header>
      <main id="home-main">
        <section
          className="home-hero home-container"
          aria-labelledby="home-hero-title"
        >
          <div className="home-hero-copy">
            <span className="home-eyebrow">
              <span className="home-eyebrow-line" /> A little intelligence. A
              lot more care.
            </span>
            <h1 id="home-hero-title">
              A calmer way to
              <br />
              run a <em>busy room.</em>
            </h1>
            <p>
              See table availability, spot service needs, and keep your
              <br className="home-desktop-break" /> team in sync—from one fixed
              camera.
            </p>
            <div className="home-hero-actions">
              <DashboardLink />
              <a href="#product" className="home-button home-button--outline">
                Explore the product <ArrowDown size={15} aria-hidden="true" />
              </a>
            </div>
            <span className="home-hero-footnote">
              Made for the people who look after people.
            </span>
          </div>
          <HeroArtifacts />
          <a href="#product" className="home-discover">
            A clearer view, a kinder service{" "}
            <ArrowDown size={14} aria-hidden="true" />
          </a>
        </section>
        <div
          className="home-principles home-container"
          aria-label="DineIQ at a glance"
        >
          <span>One fixed camera</span>
          <span>Table-by-table clarity</span>
          <span>Timely service reminders</span>
          <span>Your team, in control</span>
        </div>
        <ProductScene />
        <Workflow />
        <section
          className="home-callout-wrap home-container"
          aria-labelledby="home-callout-title"
        >
          <div className="home-callout">
            <div className="home-callout-copy">
              <span className="home-eyebrow">
                Technology with a human touch
              </span>
              <h2 id="home-callout-title">
                Less checking.
                <br />
                <em>More caring.</em>
              </h2>
              <p>
                Let DineIQ keep an eye on the little things. Service reminders
                help your team notice what needs attention. People confirm the
                work—and make the welcome.
              </p>
              <DashboardLink light />
            </div>
            <div
              className="home-callout-art"
              aria-label="Illustrative service handoff"
            >
              <span className="home-callout-orbit" aria-hidden="true" />
              <span
                className="home-callout-orbit home-callout-orbit--inner"
                aria-hidden="true"
              />
              <div className="home-handoff home-handoff--first">
                <Bell size={18} strokeWidth={1.5} aria-hidden="true" />
                <div>
                  <strong>A table needs a little care.</strong>
                  <span>DineIQ notices.</span>
                </div>
              </div>
              <div className="home-handoff home-handoff--second">
                <Check size={18} strokeWidth={1.5} aria-hidden="true" />
                <div>
                  <strong>Your team takes it from here.</strong>
                  <span>Service confirmed.</span>
                </div>
              </div>
              <span className="home-callout-art-note">
                The human part is yours.
              </span>
            </div>
          </div>
        </section>
      </main>
      <footer className="home-footer home-container">
        <div className="home-footer-top">
          <div>
            <Brand />
            <p>
              A little more clarity.
              <br />A little more room to care.
            </p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#product">
              Product <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <a href="#how-it-works">
              How it works <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <Link to="/login">
              Sign in <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </nav>
        </div>
        <div className="home-footer-bottom">
          <span>DineIQ · Dining-space intelligence</span>
          <span>Built around your room. And your people.</span>
        </div>
      </footer>
    </div>
  );
}
