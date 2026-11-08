import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowUpRight,
  Bell,
  Check,
  Clock3,
  LayoutGrid,
  Sparkles,
} from "lucide-react";
import { examples } from "./examples";
import { FloorPlan } from "./FloorPlan";
import { createExampleMotion } from "./motion";
import { Logo } from "@/components/Logo";

const icons = [LayoutGrid, Clock3, Sparkles];

export function ProductScene() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const prefix = useId();
  const stage = useRef<HTMLDivElement>(null);
  const example = examples[selected];

  useLayoutEffect(() => {
    if (stage.current) return createExampleMotion(stage.current);
  }, [selected]);

  function navigateTabs(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % examples.length;
        break;
      case "ArrowLeft":
        next = (index + examples.length - 1) % examples.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = examples.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  }

  return (
    <section
      className="home-product home-section"
      id="product"
      aria-labelledby="home-product-title"
    >
      <div className="home-container">
        <div className="home-section-intro">
          <span className="home-eyebrow">A sense of the whole room</span>
          <h2 id="home-product-title">
            Every table tells you
            <br />
            what comes <em>next.</em>
          </h2>
          <p>
            Small signals. A clearer picture. A team that knows where to be.
          </p>
        </div>
        <div
          className="home-tabs"
          role="tablist"
          aria-label="Explore DineIQ features"
        >
          {examples.map((item, index) => {
            const Icon = icons[index];
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${prefix}-tab-${item.id}`}
                aria-selected={selected === index}
                aria-controls={`${prefix}-panel-${item.id}`}
                tabIndex={selected === index ? 0 : -1}
                ref={(node) => {
                  tabs.current[index] = node;
                }}
                onClick={() => setSelected(index)}
                onKeyDown={(event) => navigateTabs(event, index)}
              >
                <Icon size={16} strokeWidth={1.6} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="home-product-stage" ref={stage}>
          {examples.map((item, index) => (
            <div
              key={item.id}
              role="tabpanel"
              id={`${prefix}-panel-${item.id}`}
              aria-labelledby={`${prefix}-tab-${item.id}`}
              hidden={selected !== index}
              tabIndex={0}
            >
              {selected === index && (
                <div className="home-product-panel">
                  <div className="home-product-copy">
                    <span className="home-eyebrow">{example.eyebrow}</span>
                    <h3>{example.title}</h3>
                    <p>{example.description}</p>
                    <div className="home-product-benefit">
                      <Check size={16} aria-hidden="true" /> {example.note}
                    </div>
                    <a href="#how-it-works" className="home-text-link">
                      See how it comes together{" "}
                      <ArrowUpRight size={17} aria-hidden="true" />
                    </a>
                  </div>
                  <div className="home-demo">
                    <div className="home-demo-topbar">
                      <span className="home-demo-brand">
                        <Logo compact /> <span>/</span> Dining room
                      </span>
                      <span className="home-example-label">Example view</span>
                    </div>
                    <div className="home-demo-body">
                      <div className="home-demo-heading">
                        <span>Floor overview</span>
                        <span>6 tables</span>
                      </div>
                      <FloorPlan tables={example.tables} />
                      <div className="home-legend">
                        <span>
                          <i className="home-legend-dot home-legend-dot--occupied" />
                          Occupied
                        </span>
                        <span>
                          <i className="home-legend-dot" />
                          Available
                        </span>
                        {selected > 0 && (
                          <span>
                            <i className="home-legend-dot home-legend-dot--attention" />
                            {selected === 1
                              ? "Needs service"
                              : "Needs cleaning"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="home-demo-bottom">
                      <div className="home-demo-metric">
                        <strong>{example.metric}</strong>
                        <span>{example.metricLabel}</span>
                      </div>
                      <div className="home-demo-notice">
                        <span className="home-notice-icon">
                          <Bell
                            size={17}
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                        </span>
                        <div>
                          <strong>{example.notification}</strong>
                          <span>{example.notificationDetail}</span>
                        </div>
                      </div>
                    </div>
                    <span className="home-demo-caption">
                      Illustrative data · Your team stays in control
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
