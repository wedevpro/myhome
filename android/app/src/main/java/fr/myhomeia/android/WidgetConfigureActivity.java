package fr.myhomeia.android;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Each launcher widget chooses its household and list independently. */
public class WidgetConfigureActivity extends Activity {
    private static final ExecutorService WORKER = Executors.newFixedThreadPool(2);
    private int widgetId;
    private int generation;
    private WidgetStore store;
    private TextView message;
    private View status;
    private ProgressBar progress;
    private ImageView statusIcon;
    private Spinner households;
    private Spinner lists;
    private Button save;
    private Button refresh;
    private final List<JSONObject> householdOptions = new ArrayList<>();
    private final List<ListOption> listOptions = new ArrayList<>();
    private JSONObject snapshot;
    private String loadedOrigin = "", loadedCookie = "", selectedHousehold = "";
    private boolean openedLogin;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }
        store = new WidgetStore(this);
        openedLogin = state != null && state.getBoolean("openedLogin");
        selectedHousehold = store.getHouseholdId(widgetId);
        buildScreen();
    }

    @Override protected void onResume() {
        super.onResume();
        if (store == null) return;
        loadHouseholds();
        if (store.getOrigin().isEmpty() && !openedLogin) { openedLogin = true; openApplication(); }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("openedLogin", openedLogin);
        super.onSaveInstanceState(state);
    }

    @Override protected void onDestroy() { generation++; super.onDestroy(); }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void buildScreen() {
        setContentView(R.layout.widget_setup);
        ScrollView scroll = findViewById(R.id.setup_scroll);
        View content = findViewById(R.id.setup_content);
        ViewGroup contentParent = (ViewGroup) content.getParent();
        // Keep the form comfortable on tablets and adapt to split-screen/insets.
        contentParent.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            int width = Math.min(dp(560), right - left - view.getPaddingLeft() - view.getPaddingRight());
            ViewGroup.LayoutParams params = content.getLayoutParams();
            if (width > 0 && params.width != width) { params.width = width; content.setLayoutParams(params); }
        });
        message = findViewById(R.id.setup_message);
        status = findViewById(R.id.setup_status);
        progress = findViewById(R.id.setup_progress);
        statusIcon = findViewById(R.id.setup_status_icon);
        households = findViewById(R.id.setup_households);
        lists = findViewById(R.id.setup_lists);
        findViewById(R.id.setup_account).setOnClickListener(view -> openApplication());
        refresh = findViewById(R.id.setup_refresh);
        refresh.setOnClickListener(view -> loadHouseholds());
        save = findViewById(R.id.setup_save);
        save.setEnabled(false);
        save.setOnClickListener(view -> finishConfiguration());
        findViewById(R.id.setup_cancel).setOnClickListener(view -> finish());
        households.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (position >= 0 && position < householdOptions.size()) {
                    String next = householdOptions.get(position).optString("id");
                    if (!next.equals(selectedHousehold) || snapshot == null ||
                            !next.equals(snapshot.optJSONObject("household") == null ? "" : snapshot.optJSONObject("household").optString("id"))) {
                        selectedHousehold = next; loadLists(next);
                    }
                }
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { save.setEnabled(false); }
        });
        lists.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                save.setEnabled(snapshot != null && lists.isEnabled() && listAt(position) != null);
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { save.setEnabled(false); }
        });
        MainActivity.applyInsets(scroll);
    }

    private void setStatus(int text, boolean loading, boolean error) {
        message.setText(text);
        message.setTextColor(getColor(error ? R.color.setup_error : R.color.setup_muted));
        status.setBackgroundResource(error ? R.drawable.setup_error_background : R.drawable.setup_status_background);
        progress.setVisibility(loading ? View.VISIBLE : View.GONE);
        statusIcon.setVisibility(loading ? View.GONE : View.VISIBLE);
        statusIcon.setColorFilter(getColor(error ? R.color.setup_error : R.color.setup_accent));
        refresh.setEnabled(!loading);
    }

    private void openApplication() {
        Intent intent = new Intent(this, MainActivity.class).putExtra("widgetConfiguration", true)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        startActivity(intent);
    }

    private void loadHouseholds() {
        final int request = ++generation;
        final String origin = store.getOrigin(), cookie = ServerClient.sessionCookie(origin);
        snapshot = null; save.setEnabled(false); households.setEnabled(false); lists.setEnabled(false);
        if (origin.isEmpty() || cookie.isEmpty()) {
            setStatus(R.string.setup_sign_in_needed, false, false);
            return;
        }
        setStatus(R.string.setup_loading_households, true, false);
        WORKER.execute(() -> {
            try {
                JSONObject result = new ServerClient(this, origin).snapshot("");
                runOnUiThread(() -> {
                    if (!accept(request, origin, cookie)) return;
                    JSONArray values = result.optJSONArray("households");
                    householdOptions.clear();
                    List<String> names = new ArrayList<>();
                    if (values != null) for (int i = 0; i < values.length(); i++) {
                        JSONObject household = values.optJSONObject(i);
                        if (household != null && MyHomeWidgetProvider.validId(household.optString("id"))) {
                            householdOptions.add(household); names.add(household.optString("name", "Foyer"));
                        }
                    }
                    households.setAdapter(adapter(names));
                    households.setEnabled(!names.isEmpty());
                    if (names.isEmpty()) { setStatus(R.string.setup_no_households, false, false); return; }
                    int selected = 0;
                    for (int i = 0; i < householdOptions.size(); i++)
                        if (selectedHousehold.equals(householdOptions.get(i).optString("id"))) selected = i;
                    selectedHousehold = householdOptions.get(selected).optString("id");
                    households.setSelection(selected);
                    loadLists(selectedHousehold);
                });
            } catch (IOException error) { showError(request, error); }
        });
    }

    private ArrayAdapter<String> adapter(List<String> values) {
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, R.layout.setup_spinner_value, values);
        adapter.setDropDownViewResource(R.layout.setup_spinner_option);
        return adapter;
    }

    /** A null list marks a section heading, never a selectable destination. */
    private static final class ListOption {
        final String label;
        final JSONObject list;

        ListOption(String label, JSONObject list) { this.label = label; this.list = list; }
        @Override public String toString() { return label; }
    }

    private final class GroupedListAdapter extends ArrayAdapter<ListOption> {
        GroupedListAdapter() {
            super(WidgetConfigureActivity.this, R.layout.setup_spinner_value, listOptions);
            setDropDownViewResource(R.layout.setup_spinner_option);
        }

        @Override public boolean areAllItemsEnabled() { return false; }
        @Override public boolean isEnabled(int position) { return listAt(position) != null; }

        @Override public View getDropDownView(int position, View convertView, ViewGroup parent) {
            TextView row = (TextView) super.getDropDownView(position, convertView, parent);
            boolean heading = !isEnabled(position);
            row.setEnabled(!heading);
            row.setTypeface(null, heading ? Typeface.BOLD : Typeface.NORMAL);
            row.setTextSize(heading ? 14 : 16);
            row.setTextColor(getColor(heading ? R.color.setup_accent : R.color.setup_text));
            row.setBackgroundResource(heading ? R.drawable.setup_status_background : 0);
            row.setPadding(dp(heading ? 16 : 32), dp(12), dp(16), dp(12));
            row.setMinimumHeight(dp(48));
            if (Build.VERSION.SDK_INT >= 28) row.setAccessibilityHeading(heading);
            return row;
        }
    }

    private JSONObject listAt(int position) {
        return position >= 0 && position < listOptions.size() ? listOptions.get(position).list : null;
    }

    private void addListGroup(JSONArray entities, String householdId, String kind, String heading) {
        if (entities == null) return;
        boolean addedHeading = false;
        for (int i = 0; i < entities.length(); i++) {
            JSONObject list = entities.optJSONObject(i);
            if (list == null || !householdId.equals(list.optString("householdId")) ||
                    !MyHomeWidgetProvider.validId(list.optString("id")) || !kind.equals(list.optString("kind"))) continue;
            if (!addedHeading) {
                listOptions.add(new ListOption(heading, null));
                addedHeading = true;
            }
            listOptions.add(new ListOption(MyHomeWidgetProvider.data(list).optString("name", "Ma liste"), list));
        }
    }

    private void loadLists(String householdId) {
        final int request = ++generation;
        final String origin = store.getOrigin(), cookie = ServerClient.sessionCookie(origin);
        snapshot = null; listOptions.clear(); lists.setAdapter(adapter(new ArrayList<>()));
        save.setEnabled(false); lists.setEnabled(false); setStatus(R.string.setup_loading_lists, true, false);
        WORKER.execute(() -> {
            try {
                JSONObject result = new ServerClient(this, origin).snapshot(householdId);
                runOnUiThread(() -> {
                    if (!accept(request, origin, cookie)) return;
                    JSONObject user = result.optJSONObject("user"), house = result.optJSONObject("household");
                    if (user == null || house == null || !householdId.equals(house.optString("id"))) {
                        setStatus(R.string.setup_household_unavailable, false, true); return;
                    }
                    JSONArray entities = result.optJSONArray("entities");
                    addListGroup(entities, householdId, "shopping", "Courses");
                    addListGroup(entities, householdId, "checklist", "Checklists");
                    snapshot = result; loadedOrigin = origin; loadedCookie = cookie;
                    lists.setAdapter(new GroupedListAdapter());
                    int selected = AdapterView.INVALID_POSITION;
                    String savedListId = store.getListId(widgetId);
                    for (int i = 0; i < listOptions.size(); i++) {
                        JSONObject list = listAt(i);
                        if (list == null) continue;
                        if (selected == AdapterView.INVALID_POSITION) selected = i;
                        if (savedListId.equals(list.optString("id"))) { selected = i; break; }
                    }
                    lists.setSelection(selected);
                    lists.setEnabled(selected != AdapterView.INVALID_POSITION);
                    save.setEnabled(listAt(selected) != null);
                    setStatus(selected == AdapterView.INVALID_POSITION ? R.string.setup_no_lists : R.string.setup_ready, false, false);
                });
            } catch (IOException error) { showError(request, error); }
        });
    }

    private boolean accept(int request, String origin, String cookie) {
        return !isFinishing() && !isDestroyed() && request == generation &&
                origin.equals(store.getOrigin()) && cookie.equals(ServerClient.sessionCookie(origin));
    }

    private void showError(int request, IOException error) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed() || request != generation) return;
            save.setEnabled(false);
            setStatus(error instanceof ServerClient.ApiException &&
                    (((ServerClient.ApiException) error).getStatus() == 401 || ((ServerClient.ApiException) error).getStatus() == 403)
                    ? R.string.setup_session_expired : R.string.setup_connection_error, false, true);
        });
    }

    private void finishConfiguration() {
        JSONObject list = listAt(lists.getSelectedItemPosition());
        if (list == null) { save.setEnabled(false); return; }
        if (snapshot == null ||
                !loadedOrigin.equals(store.getOrigin()) || !loadedCookie.equals(ServerClient.sessionCookie(loadedOrigin))) {
            loadHouseholds(); return;
        }
        if (MyHomeWidgetProvider.findList(snapshot, selectedHousehold, list.optString("id")) == null) return;
        store.saveWidget(widgetId, selectedHousehold, list.optString("id"));
        store.saveSnapshot(widgetId, snapshot, loadedOrigin, loadedCookie);
        MyHomeWidgetProvider.render(this, widgetId);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        MyHomeWidgetProvider.refreshAll(this);
        finish();
    }
}
