package android.content;

import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;

/** JVM-only Preferences boundary. The actual server/persistence methods remain unmodified. */
public class Context {
    public static final int MODE_PRIVATE = 0;
    private final Map<String, String> values = new HashMap<>();
    public Context getApplicationContext() { return this; }
    public SharedPreferences getSharedPreferences(String name, int mode) {
        return (SharedPreferences) Proxy.newProxyInstance(getClass().getClassLoader(),
            new Class<?>[]{SharedPreferences.class}, (proxy, method, args) -> {
                if (method.getName().equals("getString")) return values.getOrDefault((String) args[0], (String) args[1]);
                if (method.getName().equals("edit")) return Proxy.newProxyInstance(getClass().getClassLoader(),
                    new Class<?>[]{SharedPreferences.Editor.class}, (editor, operation, input) -> {
                        if (operation.getName().equals("putString")) { values.put((String) input[0], (String) input[1]); return editor; }
                        if (operation.getName().equals("apply")) return null;
                        throw new UnsupportedOperationException(operation.getName());
                    });
                throw new UnsupportedOperationException(method.getName());
            });
    }
}
