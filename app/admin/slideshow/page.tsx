"use client";

import { useEffect, useState } from "react";
import { AppButton } from "@/components/ui/AppButton";

export default function AdminSlideshowPage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [loopMode, setLoopMode] = useState(true);
  const [maxPhotos, setMaxPhotos] = useState(0);
  const [presentationState, setPresentationState] = useState<any>(null);

  const viewerPaused =
    presentationState?.historyMode === true ||
    presentationState?.paused === true;

  const viewerMode = presentationState?.historyMode
    ? 'History Mode'
    : presentationState?.paused
    ? 'Stopped'
    : 'Live';

  const publishPresentationState = (updates: Record<string, any>) => {
    try {
      const existing = localStorage.getItem("epix-presentation-state");
      const current = existing ? JSON.parse(existing) : {};

      localStorage.setItem(
        "epix-presentation-state",
        JSON.stringify({
          ...current,
          ...updates,
          updatedAt: Date.now(),
        })
      );
    } catch (error) {
      console.error("Failed to publish presentation state", error);
    }
  };

  useEffect(() => {
    publishPresentationState({
      controllerSlide: currentSlide,
      paused: isPaused,
      loopMode,
      maxPhotos,
    });
  }, [currentSlide, isPaused, loopMode, maxPhotos]);

  useEffect(() => {
    const loadState = () => {
      try {
        const raw =
          localStorage.getItem("epix-presentation-state") ||
          localStorage.getItem("epic-presentation-state");
        if (!raw) return;
        setPresentationState(JSON.parse(raw));
      } catch {
        // ignore bad data
      }
    };

    loadState();

    const timer = setInterval(loadState, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#111",
        color: "white",
        padding: 24,
      }}
    >
      <h1>Slideshow Presenter</h1>
      <p>V1 Presenter Console</p>
      <p style={{ opacity: 0.8 }}>
        Foundation for future Presentation Profiles, Filters, Runtime Limits,
        Audience Control, and Presenter View.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
          gap: 16,
          marginTop: 24,
        }}
      >
        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            minHeight: 420,
          }}
        >
          <h3>Current Photo</h3>
          {presentationState?.currentPhotoUrl ? (
            <>
              <img
                src={presentationState.currentPhotoUrl}
                alt="Current"
                style={{ width: "100%", maxHeight: 340, objectFit: "contain" }}
              />
              {presentationState?.currentCaption ? (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    opacity: 0.85,
                  }}
                >
                  {presentationState.currentCaption}
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ opacity: 0.6, marginTop: 12 }}>
              Waiting for slideshow data...
            </div>
          )}
        </div>

        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            minHeight: 420,
          }}
        >
          <h3>Next Photo</h3>
          {presentationState?.nextPhotoUrl ? (
            <>
              <img
                src={presentationState.nextPhotoUrl}
                alt="Next"
                style={{ width: '100%', maxHeight: 340, objectFit: 'contain' }}
              />

              {presentationState?.nextCaption ? (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    opacity: 0.85,
                  }}
                >
                  {presentationState.nextCaption}
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ opacity: 0.6, marginTop: 12 }}>
              Waiting for next-photo data...
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          marginTop: 24,
          border: '1px solid #444',
          borderRadius: 8,
          padding: 20,
          background: '#161616',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>Presentation Settings</h3>
            <div style={{ marginTop: 12 }}>
              <label>
                <input
                  type="checkbox"
                  checked={loopMode}
                  onChange={(e) => setLoopMode(e.target.checked)}
                />{' '}
                Loop Presentation
              </label>
            </div>
          </div>

          <div>
            <label>
              Max Photos:{' '}
              <input
                type="number"
                value={maxPhotos}
                min={0}
                onChange={(e) => setMaxPhotos(Number(e.target.value) || 0)}
                style={{ width: 80 }}
              />
            </label>
            <span style={{ marginLeft: 8, opacity: 0.7 }}>
              0 = all approved photos
            </span>
          </div>
        </div>

        <AppButton
          variant="success"
          onClick={() => window.open('/slideshow/view', '_blank')}
        >
          Open Audience Screen
        </AppButton>
      </div>

      <div
        style={{
          marginTop: 24,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: 24,
        }}
      >
        <div
          style={{
            marginTop: 24,
            border: '1px solid #444',
            borderRadius: 8,
            padding: 20,
            background: '#161616',
            minHeight: 250,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Show Control</h3>
            <div
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                background: '#14532d',
                color: '#4ade80',
                fontWeight: 'bold',
                fontSize: 12,
              }}
            >
              ● LIVE
            </div>
          </div>
          <div style={{ opacity: 0.7, marginBottom: 16 }}>Presentation Controls</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
          }}>
            <AppButton
              variant="start"
              onClick={() => {
                setIsPaused(false);
                publishPresentationState({
                  command: 'start',
                  paused: false,
                  historyMode: false,
                  commandAt: Date.now(),
                });
              }}
              style={{ width: '100%' }}
            >
              Start
            </AppButton>{' '}
            <AppButton
              variant="stop"
              onClick={() => {
                setIsPaused(true);
                publishPresentationState({
                  command: 'stop',
                  paused: true,
                  historyMode: false,
                  commandAt: Date.now(),
                });
              }}
              style={{ width: '100%' }}
            >
              Stop
            </AppButton>{' '}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            marginTop: 16,
          }}>
            <AppButton
              variant="muted"
              onClick={() => {
                setCurrentSlide((s) => Math.max(0, s - 1));
                publishPresentationState({
                  command: "previous",
                  commandAt: Date.now(),
                });
              }}
              style={{ width: '100%' }}
            >
              ⬅ Previous
            </AppButton>{" "}
            <AppButton
              variant="primary"
              onClick={() => {
                setCurrentSlide((s) => s + 1);
                publishPresentationState({
                  command: "next",
                  commandAt: Date.now(),
                });
              }}
              style={{ width: '100%' }}
            >
              Next ➡
            </AppButton>
          </div>
        </div>

        <div
          style={{
            border: '1px solid #444',
            borderRadius: 8,
            padding: 20,
            background: '#161616',
            minHeight: 250,
          }}
        >
          <h3>Show Status</h3>
          <div style={{ opacity: 0.7, marginBottom: 12 }}>
            Live Presentation Overview
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
              marginTop: 16,
            }}
          >
            <div style={{ border: '1px solid #16a34a', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 28, fontWeight: 'bold' }}>{viewerMode}</div>
              <div style={{ opacity: 0.7 }}>Mode</div>
            </div>

            <div style={{ border: '1px solid #2563eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 28, fontWeight: 'bold' }}>{presentationState?.slidesShown ?? 0}</div>
              <div style={{ opacity: 0.7 }}>Slides Shown</div>
            </div>

            <div style={{ border: '1px solid #9333ea', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 28, fontWeight: 'bold' }}>{presentationState?.totalSlides ?? 0}</div>
              <div style={{ opacity: 0.7 }}>Audience Slides</div>
            </div>

            <div style={{ border: '1px solid #f59e0b', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 28, fontWeight: 'bold' }}>{loopMode ? 'ON' : 'OFF'}</div>
              <div style={{ opacity: 0.7 }}>Loop Mode</div>
            </div>

            <div style={{ border: '1px solid #06b6d4', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 28, fontWeight: 'bold' }}>{maxPhotos === 0 ? 'ALL' : maxPhotos}</div>
              <div style={{ opacity: 0.7 }}>Max Photos</div>
            </div>

            <div style={{ border: '1px solid #eab308', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 28, fontWeight: 'bold' }}>{presentationState?.featuredLevel ?? 0}</div>
              <div style={{ opacity: 0.7 }}>Featured Level</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
