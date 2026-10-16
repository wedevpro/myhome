package fr.myhome.android;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.drawable.Drawable;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

public class WidgetItemsService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(), intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1),
                intent.getBooleanExtra("widgetThemeForced", false), intent.getBooleanExtra("widgetThemeDark", false));
    }

    private static class Factory implements RemoteViewsFactory {
        private final Context context;
        private final int widgetId;
        private final boolean forced;
        private final Context themed;
        private final int touchBackground;
        private final Bitmap checkedIcon, uncheckedIcon;
        private List<JSONObject> items = new ArrayList<>();
        private boolean busy;

        Factory(Context context, int id, boolean forced, boolean dark) {
            this.context = context;
            widgetId = id;
            this.forced = forced;
            themed = forced ? MyHomeWidgetProvider.widgetThemeContext(context, dark) : null;
            touchBackground = dark ? R.drawable.widget_touch_dark : R.drawable.widget_touch_light;
            checkedIcon = forced ? rasterize(themed, R.drawable.widget_checked) : null;
            uncheckedIcon = forced ? rasterize(themed, R.drawable.widget_unchecked) : null;
        }
        @Override public void onCreate() { onDataSetChanged(); }
        @Override public void onDataSetChanged() {
            WidgetStore store = new WidgetStore(context);
            JSONObject snapshot = store.getSnapshot(widgetId);
            JSONObject list = MyHomeWidgetProvider.findList(snapshot, store.getHouseholdId(widgetId), store.getListId(widgetId));
            items = MyHomeWidgetProvider.orderedItems(snapshot, list);
            busy = MyHomeWidgetProvider.isBusy(widgetId);
        }
        @Override public void onDestroy() { items.clear(); }
        @Override public int getCount() { return items.size(); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position < items.size() ? items.get(position).optString("id").hashCode() : position; }
        @Override public boolean hasStableIds() { return false; }

        @Override public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= items.size()) return null;
            JSONObject item = items.get(position), data = MyHomeWidgetProvider.data(item);
            boolean checked = data.optBoolean("checked");
            String name = data.optString("name", "Élément");
            double quantity = data.optDouble("quantity", 1);
            if (quantity > 1) {
                String value = quantity == Math.rint(quantity) ? Long.toString((long) quantity) : Double.toString(quantity);
                name += " × " + value + (data.optString("unit").isEmpty() ? "" : " " + data.optString("unit"));
            }
            if (!data.optString("linkedChecklistId").isEmpty()) name += " ↗";
            RemoteViews row = new RemoteViews(context.getPackageName(),
                    forced ? R.layout.widget_item_forced : R.layout.widget_item);
            row.setTextViewText(R.id.widget_item_name, name);
            row.setInt(R.id.widget_item_name, "setPaintFlags", Paint.ANTI_ALIAS_FLAG | (checked ? Paint.STRIKE_THRU_TEXT_FLAG : 0));
            if (forced) {
                row.setTextColor(R.id.widget_item_name, themed.getColor(checked ? R.color.widget_completed : R.color.widget_text));
                row.setTextColor(R.id.widget_item_note, themed.getColor(R.color.widget_muted));
                row.setInt(R.id.widget_item_divider, "setBackgroundColor", themed.getColor(R.color.widget_divider));
                for (int id : new int[]{R.id.widget_item_check, R.id.widget_item_text, R.id.widget_item_edit, R.id.widget_item_delete})
                    row.setInt(id, "setBackgroundResource", touchBackground);
                row.setInt(R.id.widget_item_edit, "setColorFilter", themed.getColor(R.color.widget_muted));
                row.setInt(R.id.widget_item_delete, "setColorFilter", themed.getColor(R.color.widget_danger));
                // Preserve the two colors of checked boxes without host-side resource resolution.
                row.setImageViewBitmap(R.id.widget_item_check, checked ? checkedIcon : uncheckedIcon);
            } else {
                // Keep resource references so a launcher can re-inflate for system night changes.
                row.setImageViewResource(R.id.widget_item_check, checked ? R.drawable.widget_checked : R.drawable.widget_unchecked);
            }
            row.setContentDescription(R.id.widget_item_check, (checked ? "Décocher " : "Cocher ") + data.optString("name"));
            row.setContentDescription(R.id.widget_item_edit, "Modifier " + data.optString("name"));
            row.setContentDescription(R.id.widget_item_delete, "Supprimer " + data.optString("name"));
            String note = data.optString("comment");
            row.setTextViewText(R.id.widget_item_note, note);
            row.setViewVisibility(R.id.widget_item_note, note.isEmpty() ? View.GONE : View.VISIBLE);
            row.setBoolean(R.id.widget_item_check, "setEnabled", !busy);
            row.setInt(R.id.widget_item_check, "setImageAlpha", busy ? 102 : 255);
            row.setOnClickFillInIntent(R.id.widget_item_check, click(item, "toggle"));
            row.setOnClickFillInIntent(R.id.widget_item_text, click(item, "open"));
            row.setOnClickFillInIntent(R.id.widget_item_edit, click(item, "edit"));
            row.setOnClickFillInIntent(R.id.widget_item_delete, click(item, "delete"));
            return row;
        }

        private static Bitmap rasterize(Context themed, int resource) {
            Drawable drawable = themed.getDrawable(resource).mutate();
            int size = Math.max(1, Math.round(24 * themed.getResources().getDisplayMetrics().density));
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            drawable.setBounds(0, 0, size, size);
            drawable.draw(new Canvas(bitmap));
            return bitmap;
        }

        private Intent click(JSONObject item, String action) {
            return new Intent().putExtra(MyHomeWidgetProvider.EXTRA_ITEM, item.optString("id"))
                    .putExtra(MyHomeWidgetProvider.EXTRA_ACTION, action);
        }
    }
}
