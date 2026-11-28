// The parts of UnityEngine that lib/client/unity/GamesFun.cs uses, with Unity's own names and signatures and no
// behaviour: scripts/check-engines.mjs compiles GamesFun.cs against it, so a call Unity does not have, or C# that Unity's
// compiler would refuse, fails CI. A new UnityEngine call in GamesFun.cs is added here as Unity declares it.
namespace UnityEngine
{
    public class Object
    {
        public static void DontDestroyOnLoad(Object target) { }
    }

    public class Component : Object { }

    public class Behaviour : Component { }

    public class MonoBehaviour : Behaviour { }

    public sealed class GameObject : Object
    {
        public GameObject(string name) { }

        public T AddComponent<T>() where T : Component => default;
    }

    public enum RuntimeInitializeLoadType
    {
        AfterSceneLoad = 0,
        BeforeSceneLoad = 1,
        AfterAssembliesLoaded = 2,
        BeforeSplashScreen = 3,
        SubsystemRegistration = 4,
    }

    [System.AttributeUsage(System.AttributeTargets.Method, AllowMultiple = false)]
    public class RuntimeInitializeOnLoadMethodAttribute : System.Attribute
    {
        public RuntimeInitializeOnLoadMethodAttribute() { }

        public RuntimeInitializeOnLoadMethodAttribute(RuntimeInitializeLoadType loadType) { }
    }

    public static class JsonUtility
    {
        public static T FromJson<T>(string json) => default;

        public static string ToJson(object obj) => null;
    }

    public static class Random
    {
        public static int Range(int minInclusive, int maxExclusive) => minInclusive;

        public static float Range(float minInclusive, float maxInclusive) => minInclusive;
    }

    public static class Debug
    {
        public static void Log(object message) { }

        public static void LogWarning(object message) { }

        public static void LogError(object message) { }
    }
}
