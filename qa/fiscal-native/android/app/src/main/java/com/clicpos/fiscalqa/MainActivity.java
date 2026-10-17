package com.clicpos.fiscalqa;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.community.database.sqlite.CapacitorSQLitePlugin;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle state) { registerPlugin(CapacitorSQLitePlugin.class); super.onCreate(state); }
}
