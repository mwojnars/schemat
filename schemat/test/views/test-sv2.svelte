<script context="module">
    export async function load() {
        const data = await Promise.resolve([
            { id: 1, title: 'Hello Rune World' },
            { id: 2, title: 'Svelte 5 FTW' }
        ])
        return { data }
    }
</script>


<script>
    // let { data } = $props()
    let title = "Svelte Test Page"
    let description = "Default description"
</script>


<svelte:head>
    <title>{title}</title>
    <meta name="description" content={description}>
    <meta property="og:title" content={title}>
</svelte:head>


<h1>{title}</h1>
<p>Welcome to this page!</p>
