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
    ? 'Paused'
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
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 24,
        }}
      >
        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            minHeight: 300,
          }}
        >
          <h3>Current Photo</h3>
          {presentationState?.currentPhotoUrl ? (
            <>
              <img
                src={presentationState.currentPhotoUrl}
                alt="Current"
                style={{ width: "100%", maxHeight: 220, objectFit: "contain" }}
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
            minHeight: 300,
          }}
        >
          <h3>Next Photo</h3>
          {presentationState?.nextPhotoUrl ? (
            <>
              <img
                src={presentationState.nextPhotoUrl}
                alt="Next"
                style={{ width: '100%', maxHeight: 220, objectFit: 'contain' }}
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
          padding: 16,
        }}
      >
        <h3>Presentation Settings</h3>

        <div style={{ marginTop: 12 }}>
          <label>
            Loop Presentation{' '}
            <input
              type="checkbox"
              checked={loopMode}
              onChange={(e) => setLoopMode(e.target.checked)}
            />
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          <label>
            Max Photos:{' '}
            <input
              type="number"
              value={maxPhotos}
              min={0}
              onChange={(e) => setMaxPhotos(Number(e.target.value) || 0)}
              style={{ width: 100 }}
            />
          </label>
          <span style={{ marginLeft: 8, opacity: 0.7 }}>
            0 = all approved photos
          </span>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
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
        >
          Start
        </AppButton>{' '}
        <AppButton
          variant="muted"
          onClick={() => {
            setCurrentSlide((s) => Math.max(0, s - 1));
            publishPresentationState({
              command: "previous",
              commandAt: Date.now(),
            });
          }}
        >
          Previous
        </AppButton>{" "}
        <AppButton
          variant="primary"
          onClick={() => {
            const nextPaused = !viewerPaused;
            setIsPaused(nextPaused);

            publishPresentationState({
              command: nextPaused ? "pause" : "resume",
              paused: nextPaused,
              historyMode: false,
              commandAt: Date.now(),
            });
          }}
        >
          {viewerPaused ? 'Resume' : 'Pause'}
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
        >
          Stop
        </AppButton>{' '}
        <AppButton
          variant="primary"
          onClick={() => {
            setCurrentSlide((s) => s + 1);
            publishPresentationState({
              command: "next",
              commandAt: Date.now(),
            });
          }}
        >
          Next
        </AppButton>
        <div style={{ marginTop: 8, fontWeight: 'bold' }}>
          Mode: {viewerMode}
        </div>
        <div
          style={{
            marginTop: 8,
            display: 'inline-block',
            padding: '8px 12px',
            borderRadius: 6,
            background: '#1f2937',
            fontWeight: 'bold',
          }}
        >
          Slides Shown: {presentationState?.slidesShown ?? 0}
        </div>
      </div>

      <div style={{ marginTop: 12, opacity: 0.8 }}>
        Current Slide: {currentSlide}<br />
        Status: {viewerMode}<br />
        Loop Mode: {loopMode ? 'Enabled' : 'Disabled'}<br />
        Max Photos: {maxPhotos === 0 ? 'All' : maxPhotos}<br />
        Audience Slides: {presentationState?.totalSlides ?? 0}<br />
        Featured Level: {presentationState?.featuredLevel ?? 0}
      </div>

      <div style={{ marginTop: 24 }}>
        <AppButton
          variant="success"
          onClick={() => window.open('/slideshow/view', '_blank')}
        >
          Open Audience Screen
        </AppButton>
      </div>
    </div>
  );
}
