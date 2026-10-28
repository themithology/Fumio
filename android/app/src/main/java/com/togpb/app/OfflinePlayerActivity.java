package com.togpb.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Native playback for a DOWNLOADED file.
 *
 * The website plays in a WebView; a file on the phone should not. This is a
 * real native player (Media3 / ExoPlayer) so that:
 *
 *   • MKV works — including the multi-audio MKVs the download pools hand out
 *     (Hindi + English + original), which is exactly what a WebView <video>
 *     cannot do;
 *   • every audio track and every embedded subtitle is selectable
 *     (Audio / Subtitles buttons), with the language named in the list
 *     ("Hindi", "English", "Japanese"…);
 *   • it matches the app's monochrome theme — black, white pills, zinc
 *     secondary text — because it is drawn here, not by the site;
 *   • it works with the network off: the URI is a local file that
 *     DownloadManager already owns.
 *
 * Resume position is stored per file (DownloadsLibrary.saveResume) so a
 * two-hour MKV does not start from zero every time.
 */
@UnstableApi
public class OfflinePlayerActivity extends AppCompatActivity {

    static final String EXTRA_URI = "fumio.uri";
    static final String EXTRA_TITLE = "fumio.title";

    private static final int ZINC_300 = 0xFFD4D4D8;
    private static final int ZINC_500 = 0xFF71717A;

    private ExoPlayer player;
    private PlayerView playerView;
    private FrameLayout root;
    private TextView audioButton;
    private TextView subtitleButton;

    private String uriKey = "";
    private long resumeMs = 0;
    private boolean resumeApplied = false;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String raw = getIntent() == null ? null : getIntent().getStringExtra(EXTRA_URI);
        String title = getIntent() == null ? null : getIntent().getStringExtra(EXTRA_TITLE);
        if (raw == null || raw.isEmpty()) {
            finish();
            return;
        }
        uriKey = raw;
        resumeMs = DownloadsLibrary.resumeFor(this, uriKey);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        playerView = new PlayerView(this);
        playerView.setLayoutParams(
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        playerView.setBackgroundColor(Color.BLACK);
        playerView.setUseController(true);
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        playerView.setKeepContentOnPlayerReset(true);
        root.addView(playerView);

        buildChrome(title);

        player = new ExoPlayer.Builder(this).build();
        player.setAudioAttributes(androidx.media3.common.AudioAttributes.DEFAULT, true);
        player.addListener(
            new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY) {
                        if (!resumeApplied) {
                            resumeApplied = true;
                            if (resumeMs > 1500) player.seekTo(resumeMs);
                        }
                        refreshTrackButtons();
                    } else if (state == Player.STATE_ENDED) {
                        DownloadsLibrary.saveResume(OfflinePlayerActivity.this, uriKey, 0);
                    }
                }

                @Override
                public void onTracksChanged(Tracks tracks) {
                    refreshTrackButtons();
                }
            }
        );
        playerView.setPlayer(player);
        player.setMediaItem(MediaItem.fromUri(Uri.parse(raw)));
        player.setPlayWhenReady(true);
        player.prepare();

        SystemBars.hide(getWindow());
    }

    /** Black bar with the title, and the two track pills the theme expects. */
    private void buildChrome(String title) {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        barParams.gravity = Gravity.TOP;
        int pad = dp(12);
        bar.setPadding(pad, pad, pad, pad);
        root.addView(bar, barParams);

        TextView heading = new TextView(this);
        heading.setText(TextUtils.isEmpty(title) ? "Downloaded" : title);
        heading.setTextColor(Color.WHITE);
        heading.setTextSize(13);
        heading.setSingleLine(true);
        heading.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams headingParams = new LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1f
        );
        bar.addView(heading, headingParams);

        audioButton = pill("Audio");
        audioButton.setOnClickListener(v -> pickTrack(true));
        bar.addView(audioButton);

        subtitleButton = pill("Subtitles");
        subtitleButton.setOnClickListener(v -> pickTrack(false));
        bar.addView(subtitleButton);

        TextView close = pill("Close");
        close.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        closeParams.leftMargin = dp(8);
        bar.addView(close, closeParams);

        // Auto-hide with the controls so it never covers the picture.
        bar.setAlpha(0f);
        playerView.setControllerVisibilityListener(
            new PlayerView.ControllerVisibilityListener() {
                @Override
                public void onVisibilityChanged(int visibility) {
                    bar.animate().alpha(visibility == View.VISIBLE ? 1f : 0f).setDuration(180).start();
                }
            }
        );
    }

    private TextView pill(String label) {
        TextView view = new TextView(this);
        view.setText(label);
        view.setTextColor(ZINC_300);
        view.setTextSize(11);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(12), dp(7), dp(12), dp(7));
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(0xCC101010);
        shape.setCornerRadius(dp(18));
        shape.setStroke(dp(1), 0x33FFFFFF);
        view.setBackground(shape);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.leftMargin = dp(8);
        view.setLayoutParams(params);
        return view;
    }

    private void refreshTrackButtons() {
        if (player == null) return;
        int audio = 0;
        int text = 0;
        try {
            for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
                if (group.getType() == C.TRACK_TYPE_AUDIO) audio += group.length;
                if (group.getType() == C.TRACK_TYPE_TEXT) text += group.length;
            }
        } catch (Exception ignored) {
            return;
        }
        if (audioButton != null) {
            audioButton.setText(audio > 1 ? "Audio · " + audio : "Audio");
            audioButton.setTextColor(audio > 1 ? Color.WHITE : ZINC_500);
        }
        if (subtitleButton != null) {
            subtitleButton.setText(text > 0 ? "Subtitles · " + text : "Subtitles");
            subtitleButton.setTextColor(text > 0 ? Color.WHITE : ZINC_500);
        }
    }

    /** Every audio track / subtitle the container actually carries. */
    private void pickTrack(boolean audio) {
        if (player == null) return;
        List<String> labels = new ArrayList<>();
        List<Tracks.Group> groups = new ArrayList<>();
        List<Integer> indices = new ArrayList<>();
        try {
            for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
                if (audio ? group.getType() != C.TRACK_TYPE_AUDIO : group.getType() != C.TRACK_TYPE_TEXT) continue;
                for (int i = 0; i < group.length; i += 1) {
                    if (!group.isTrackSupported(i)) continue;
                    labels.add(describe(group.getTrackFormat(i), audio));
                    groups.add(group);
                    indices.add(i);
                }
            }
        } catch (Exception ignored) {
            /* fall through to the empty-state message */
        }
        if (!audio) labels.add(0, "Off");
        if (labels.isEmpty()) {
            toast(audio ? "This file has one audio track" : "This file has no subtitles");
            return;
        }
        CharSequence[] items = labels.toArray(new CharSequence[0]);
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(audio ? "Audio track" : "Subtitles")
            .setItems(
                items,
                (dialog, which) -> {
                    if (player == null) return;
                    TrackSelectionParameters.Builder params = player.getTrackSelectionParameters().buildUpon();
                    if (!audio && which == 0) {
                        params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
                        player.setTrackSelectionParameters(params.build());
                        toast("Subtitles off");
                        return;
                    }
                    int index = audio ? which : which - 1;
                    if (index < 0 || index >= groups.size()) return;
                    Tracks.Group group = groups.get(index);
                    params.setOverrideForType(
                        new TrackSelectionOverride(group.getMediaTrackGroup(), indices.get(index))
                    );
                    if (!audio) params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false);
                    player.setTrackSelectionParameters(params.build());
                }
            )
            .show();
    }

    /** "Hindi · 5.1" — the thing the WebView could never show us. */
    private static String describe(Format format, boolean audio) {
        if (format == null) return audio ? "Audio" : "Subtitle";
        List<String> parts = new ArrayList<>();
        String language = languageName(format.language);
        if (!language.isEmpty()) parts.add(language);
        if (!TextUtils.isEmpty(format.label)) parts.add(format.label);
        if (audio && format.channelCount > 2) parts.add(format.channelCount + "ch");
        if (audio && format.bitrate > 0) parts.add(Math.round(format.bitrate / 1000f) + " kbps");
        if (!audio && !TextUtils.isEmpty(format.sampleMimeType) && format.sampleMimeType.contains("pgs")) {
            parts.add("image");
        }
        if (parts.isEmpty()) parts.add(audio ? "Default audio" : "Default subtitle");
        return TextUtils.join(" · ", parts);
    }

    private static String languageName(String code) {
        if (code == null) return "";
        String clean = code.trim();
        if (clean.isEmpty() || clean.equalsIgnoreCase("und")) return "";
        try {
            String name = new Locale(clean).getDisplayLanguage(Locale.ENGLISH);
            if (name == null || name.isEmpty() || name.equalsIgnoreCase(clean)) return clean.toUpperCase(Locale.US);
            return name.substring(0, 1).toUpperCase(Locale.US) + name.substring(1);
        } catch (Exception ignored) {
            return clean.toUpperCase(Locale.US);
        }
    }

    private void toast(String message) {
        try {
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) {
            /* no window */
        }
    }

    private int dp(int value) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    @Override
    protected void onStop() {
        rememberPosition();
        if (player != null) player.pause();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        rememberPosition();
        if (playerView != null) playerView.setPlayer(null);
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }

    private void rememberPosition() {
        try {
            if (player != null && player.getCurrentPosition() > 3000 && player.getPlaybackState() != Player.STATE_ENDED) {
                DownloadsLibrary.saveResume(this, uriKey, player.getCurrentPosition());
            }
        } catch (Exception ignored) {
            /* resume is optional */
        }
    }

    /** Lets the Downloads list (or a future site link) open a saved file. */
    static Intent intentFor(android.content.Context context, Uri uri, String title) {
        Intent intent = new Intent(context, OfflinePlayerActivity.class);
        intent.putExtra(EXTRA_URI, uri == null ? "" : uri.toString());
        intent.putExtra(EXTRA_TITLE, title == null ? "" : title);
        if (Build.VERSION.SDK_INT < 26) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }
}
