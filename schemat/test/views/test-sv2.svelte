<script module>
    export async function load(request) {
        return await Promise.resolve([
            {id: 1, title: 'Hello Rune World'},
            {id: 2, title: 'Svelte 5 FTW'}
        ])
    }
</script>


<script>
    // let {data} = $props()       // `data` attribute comes from load() function in <script module> section
    // let title = $state(data[0].title)
    let title = $state("Hello Rune World")  //("Svelte Test Page")
    let description = $state("Default description")
    let count = $state(0)
    let title_length = $derived(title.length)

    $effect(() => {
        document.title = title
    })

    function inc_count() {
        count += 1
    }
</script>


<svelte:head>
    <title>{title}</title>
    <meta name="description" content={description}>
    <meta property="og:title" content={title}>
</svelte:head>


<h1>{title}</h1>
<p>Welcome to this page!</p>

<div class="controls">
    <label>
        Edit title:
        <input type="text" bind:value={title} placeholder="Type to change the title">
    </label>
    <small>({title_length} chars)</small>
    <div class="counter">
        <button onclick={inc_count}>+1</button>
        <span>count: {count}</span>
    </div>
    <p class="hint">changing the input updates the heading and the document title</p>
    <p class="hint">clicking the button updates the counter</p>
    
</div>

<style>
    h1 {
        color: #2b6cb0;
        margin-bottom: 0.5rem;
    }

    p {
        margin: 0.25rem 0;
    }

    .controls {
        margin-top: 1rem;
        padding: 0.75rem;
        border: 1px solid #e2e8f0;
    }

    input[type="text"] {
        padding: 0.25rem 0.5rem;
        border: 1px solid #cbd5e1;
    }

    .counter {
        margin-top: 0.5rem;
        display: inline-flex;
    }

    button {
        padding: 0.25rem 0.5rem;
        background: #0ea5e9;
        color: white;
        cursor: pointer;
    }

    .hint {
        font-size: 0.85rem;
    }
</style>
