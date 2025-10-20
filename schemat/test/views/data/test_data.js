// test_data.js
export const articles = [
    {
        id: 1,
        title: 'First Article',
        content: 'This is the content of the first article'
    },
    {
        id: 2,
        title: 'Second Article',
        content: 'This is the content of the second article'
    }
]

export const fetchArticle = async (id) => {
    // simulate async operation
    await new Promise(resolve => setTimeout(resolve, 100))
    return articles.find(article => article.id === id)
}

export default {
    articles,
    fetchArticle
}
